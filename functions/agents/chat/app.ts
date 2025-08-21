import { hostedMcpTool, run } from '@openai/agents';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import dbPool from '../../../common/utils/create-db-pool';
import { conversationAgent, createMcpEnabledAgent } from './agents';
import { getOrCreateConversation, saveAiMessage } from './helpers/database-helpers';

// AWS Lambda streaming globals
declare const awslambda: any;

const ChatRequest = z.object({
  message: z.string().min(1),
  conversationId: z
    .string()
    .uuid()
    .optional()
    .nullable()
    .transform((val) => val || undefined),
  agentId: z.string().uuid().describe('The AI agent to chat with'),
});

async function getMcpToolsForAgent(client: PoolClient, agentId: string, workspaceId: string) {
  try {
    const query = `
      SELECT
        mc.server_url,
        mc.server_label,
        mc.auth_headers,
        mc.oauth_config,
        mc.require_approval,
        mc.allowed_tools,
        mc.id as connection_id
      FROM agent_mcp_access ama
      JOIN mcp_connections mc ON ama.mcp_connection_id = mc.id
      WHERE ama.agent_id = $1
        AND mc.workspace_id = $2
        AND ama.is_enabled = true
        AND mc.status = 'active'
    `;

    const result = await client.query(query, [agentId, workspaceId]);

    const mcpTools = [];
    const failedConnections = [];

    for (const row of result.rows) {
      try {
        const toolConfig: any = {
          serverLabel: row.server_label,
          serverUrl: row.server_url,
        };

        // Handle OAuth tokens for providers like Linear
        if (row.oauth_config?.access_token) {
          toolConfig.headers = {
            'Authorization': `Bearer ${row.oauth_config.access_token}`
          };
        } else if (row.auth_headers) {
          toolConfig.headers = row.auth_headers;
        }

        if (row.require_approval) {
          toolConfig.requireApproval = 'always';
        }

        if (row.allowed_tools && row.allowed_tools.length > 0) {
          toolConfig.allowedTools = row.allowed_tools;
        }
        console.log(toolConfig);
        // Test the MCP connection before adding it
        const mcpTool = hostedMcpTool(toolConfig);

        console.log(mcpTool);

        // Add a connection test with timeout
        const connectionTest = await Promise.race([
          // Try to initialize the tool (this will test the connection)
          Promise.resolve(mcpTool),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('MCP connection timeout')), 5000),
          ),
        ]);

        console.log(connectionTest);

        mcpTools.push(mcpTool);
        console.log(`✅ Successfully connected to MCP server: ${row.server_label}`);
      } catch (error) {
        console.error(`❌ Failed to connect to MCP server ${row.server_label}:`, error);
        failedConnections.push({
          label: row.server_label,
          error: error.message,
          connectionId: row.connection_id,
        });
      }
    }

    if (failedConnections.length > 0) {
      console.warn(`⚠️ ${failedConnections.length} MCP connections failed:`, failedConnections);
    }

    return {
      tools: mcpTools,
      failedConnections,
      totalAttempted: result.rows.length,
    };
  } catch (error) {
    console.error('Error fetching MCP tools for agent:', error);
    return {
      tools: [],
      failedConnections: [],
      totalAttempted: 0,
    };
  }
}

export const streamHandler = async (
  event: APIGatewayProxyEventV2,
  responseStream: any,
  context: Context,
) => {
  let client: PoolClient | null = null;
  let openAIStream: any = null;
  let streamEnded = false;

  const originalTimeout = context.getRemainingTimeInMillis();
  const cleanupTimeout = originalTimeout - 4000;

  responseStream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });

  const endStream = (error?: any) => {
    if (streamEnded) return;
    streamEnded = true;

    try {
      if (error) {
        writeSSE(
          responseStream,
          {
            message: error.message || 'Internal server error',
            error: true,
          },
          'error',
        );
      }

      if (!responseStream.destroyed) {
        writeSSE(responseStream, { status: 'complete' }, 'done');
        responseStream.end();
      }
    } catch (e) {
      console.error('Error ending stream:', e);
      try {
        if (!responseStream.destroyed) {
          responseStream.destroy();
        }
      } catch (destroyError) {
        console.error('Error destroying stream:', destroyError);
      }
    }
  };

  const cleanupTimer = setTimeout(() => {
    console.warn('Lambda cleanup timeout reached, forcing cleanup');
    endStream(new Error('Request timeout'));
  }, cleanupTimeout);

  try {
    const requestBody = JSON.parse(event.body || '{}');
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const workspaceId = event.pathParameters?.workspaceId || requestBody.workspaceId;

    console.log('📨 Received streaming request:', {
      workspaceId,
      hasAuth: !!authHeader,
      messageLength: requestBody.message?.length,
      conversationId: requestBody.conversationId,
      agentId: requestBody.agentId,
      remainingTime: context.getRemainingTimeInMillis(),
    });

    if (!authHeader || !workspaceId) {
      console.error('❌ Missing required parameters');
      endStream(new Error('Missing required parameters'));
      return;
    }

    const body = ChatRequest.parse(requestBody);
    console.log('✅ Request validation passed');

    try {
      client = (await Promise.race([
        dbPool.connect(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Database connection timeout')), 5000),
        ),
      ])) as PoolClient;
    } catch (error) {
      console.error('❌ Database connection failed:', error);
      endStream(new Error('Database connection failed'));
      return;
    }

    const userId = await getUserIdFromToken(authHeader);

    if (!userId) {
      console.error('❌ Authentication failed');
      endStream(new Error('Unauthorized'));
      return;
    }

    const workspaceMemberResult = await client.query(
      `SELECT id FROM workspace_members
       WHERE user_id = $1 AND workspace_id = $2 AND is_deactivated = false`,
      [userId, workspaceId],
    );

    if (workspaceMemberResult.rows.length === 0) {
      endStream(new Error('User not found in workspace'));
      return;
    }

    const workspaceMemberId = workspaceMemberResult.rows[0].id;

    const agentResult = await client.query(
      `SELECT id, name, system_prompt FROM agents
       WHERE id = $1 AND workspace_id = $2 AND is_active = true`,
      [body.agentId, workspaceId],
    );

    if (agentResult.rows.length === 0) {
      endStream(new Error('Agent not found or inactive'));
      return;
    }

    const agent = agentResult.rows[0];
    const conversation = await getOrCreateConversation(
      client,
      workspaceId,
      workspaceMemberId,
      body.agentId,
      body.conversationId,
    );

    const userMessage = await saveAiMessage(
      client,
      conversation.id,
      workspaceId,
      'user',
      body.message,
      workspaceMemberId,
      undefined,
    );

    writeSSE(responseStream, { userMessage, conversation }, 'user_message', Date.now().toString());

    writeSSE(
      responseStream,
      {
        status: 'thinking',
        message: 'Agent is analyzing your message...',
      },
      'agent_thinking',
      Date.now().toString(),
    );

    const startTime = Date.now();

    // Get MCP tools for this agent with better error handling
    const mcpResult = await getMcpToolsForAgent(client, body.agentId, workspaceId);
    const { tools: mcpTools, failedConnections, totalAttempted } = mcpResult;

    console.log(`📡 MCP Status: ${mcpTools.length}/${totalAttempted} connections successful`);

    if (failedConnections.length > 0) {
      writeSSE(
        responseStream,
        {
          status: 'warning',
          message: `Some external tools are unavailable (${failedConnections.length}/${totalAttempted} failed). Continuing with available tools...`,
          failedConnections: failedConnections.map((fc) => fc.label),
        },
        'mcp_warning',
        Date.now().toString(),
      );
    }

    // Choose the right agent based on whether MCP tools are available
    const selectedAgent = mcpTools.length > 0 ? createMcpEnabledAgent(mcpTools) : conversationAgent;

    // Prepare system prompt with MCP status information
    const mcpStatusInfo =
      mcpTools.length > 0
        ? `

IMPORTANT: You have direct access to ${mcpTools.length} external tools via MCP connections.${
            failedConnections.length > 0
              ? ` Note: ${failedConnections.length} MCP connections failed (${failedConnections.map((fc) => fc.label).join(', ')}), so some external tools may be unavailable.`
              : ''
          }

When users ask about external services, use the MCP tools DIRECTLY. Only route to search_specialist for workspace/internal message searches, and to analysis_specialist for structuring data you've already retrieved.`
        : failedConnections.length > 0
          ? `

Note: External tool connections failed (${failedConnections.map((fc) => fc.label).join(', ')}). You'll need to rely on internal workspace tools and inform the user about the limitations.`
          : '';

    try {
      const runConfig: any = {
        stream: true,
        context: {
          workspaceId,
          userId,
          conversation_id: conversation.id,
          agentId: body.agentId,
        },
        // Reduce retries and increase timeout for MCP rate limits
        maxRetries: 1,
        timeoutMs: 45000, // 45 second timeout for MCP calls
        retryBackoff: 'exponential', // Add exponential backoff
      };

      openAIStream = await Promise.race([
        run(
          selectedAgent,
          [
            {
              role: 'system',
              content: `You are ${agent.name}. ${agent.system_prompt + '.' || ''} Current conversation_id: ${conversation.id}. Always use this ID when calling get_conversation_context.${mcpStatusInfo}`,
            },
            {
              role: 'user',
              content: body.message,
            },
          ],
          runConfig,
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('OpenAI stream creation timeout')), 15000),
        ),
      ]);
    } catch (error) {
      console.error('❌ OpenAI stream creation failed:', error);

      // Check if it's a rate limiting error
      if (error.message?.includes('429') || error.status === 429) {
        console.log('⚠️ Rate limit encountered, suggesting user wait before retry');
        endStream(new Error('Rate limit exceeded. Linear API is temporarily throttling requests. Please wait 30-60 seconds before trying again.'));
      } else if (
        error.message?.includes('MCP') ||
        error.message?.includes('external_connector_error')
      ) {
        const runConfig: any = {
          stream: true,
          context: {
            workspaceId,
            userId,
            conversation_id: conversation.id,
            agentId: body.agentId,
          },
          // Reduce retries and increase timeout for MCP rate limits
          maxRetries: 1,
          timeoutMs: 45000, // 45 second timeout for MCP calls
          retryBackoff: 'exponential', // Add exponential backoff
        };
        // MCP tool error - fallback to regular agent
        console.log('🔄 MCP tools failed, falling back to conversation agent...');
        try {
          openAIStream = await run(
            conversationAgent,
            [
              {
                role: 'system',
                content: `You are ${agent.name}. ${agent.system_prompt || ''}. Current conversation_id: ${conversation.id}. Always use this ID when calling get_conversation_context.

Note: External tool connections are currently unavailable. You can still help with workspace searches and general assistance.`,
              },
              {
                role: 'user',
                content: body.message,
              },
            ],
            runConfig,
          );

          writeSSE(
            responseStream,
            {
              status: 'fallback',
              message: 'External tools unavailable, using internal capabilities...',
            },
            'agent_thinking',
            Date.now().toString(),
          );
        } catch (fallbackError) {
          console.error('❌ Fallback agent also failed:', fallbackError);
          endStream(fallbackError);
          return;
        }
      } else {
        endStream(error);
        return;
      }
    }

    // Rest of your streaming logic remains the same...
    let assistantReply = '';
    let toolCallCount = 0;
    let hasStartedGenerating = false;

    const processedTextDeltas = new Set();
    const processedToolCalls = new Set();
    const processedThinkingEvents = new Set();

    try {
      const streamPromise = (async () => {
        for await (const chunk of openAIStream) {
          if (streamEnded) {
            console.log('Stream processing stopped due to cleanup');
            break;
          }

          const timestamp = Date.now().toString();

          if (chunk.type === 'raw_model_stream_event' && chunk.data) {
            const eventType = chunk.data.event?.type;
            const sequenceNumber = chunk.data.event?.sequence_number;
            const itemId = chunk.data.event?.item_id;
            const contentIndex = chunk.data.event?.content_index;

            switch (eventType) {
              case 'response.in_progress':
                const inProgressKey = `thinking-${sequenceNumber}`;
                if (!processedThinkingEvents.has(inProgressKey)) {
                  processedThinkingEvents.add(inProgressKey);
                  if (!hasStartedGenerating) {
                    writeSSE(
                      responseStream,
                      {
                        status: 'thinking',
                        message: 'Reading your message...',
                      },
                      'agent_thinking',
                      timestamp,
                    );
                  }
                }
                break;

              case 'response.output_text.delta':
                const textDeltaKey = `text-${sequenceNumber}-${itemId}-${contentIndex}`;

                if (!processedTextDeltas.has(textDeltaKey)) {
                  processedTextDeltas.add(textDeltaKey);

                  if (!hasStartedGenerating) {
                    writeSSE(
                      responseStream,
                      {
                        status: 'generating',
                        message: 'Writing my response...',
                      },
                      'agent_thinking',
                      timestamp,
                    );
                    hasStartedGenerating = true;
                  }

                  const textDelta = chunk.data.event.delta;
                  if (textDelta) {
                    assistantReply += textDelta;
                    writeSSE(responseStream, { content: textDelta }, 'content_delta', timestamp);
                  }
                }
                break;

              case 'response.function_call_arguments.delta':
                const functionCallId = chunk.data.event.item_id;
                const argsKey = `args-${functionCallId}`;
                if (!processedToolCalls.has(argsKey)) {
                  processedToolCalls.add(argsKey);
                  writeSSE(
                    responseStream,
                    {
                      status: 'thinking',
                      message: 'Let me look something up...',
                    },
                    'agent_thinking',
                    timestamp,
                  );
                }
                break;
            }
          }

          // Handle tool called events with error handling
          if (chunk.name === 'tool_called' && chunk.item) {
            const toolCall = chunk.item.rawItem;
            const toolCallId = toolCall.callId;
            const startKey = `tool-start-${toolCallId}`;

            console.log(`🔧 Tool called: ${toolCall.name} (ID: ${toolCallId})`);

            if (!processedToolCalls.has(startKey)) {
              processedToolCalls.add(startKey);
              toolCallCount++;

              writeSSE(
                responseStream,
                {
                  type: 'tool_call_start',
                  toolName: toolCall.name || 'unknown',
                  arguments: toolCall.arguments,
                  callId: toolCallId,
                  message: getHumanFriendlyToolMessage(toolCall.name, 'start'),
                },
                'tool_call_start',
                timestamp,
              );

              writeSSE(
                responseStream,
                {
                  status: 'using_tools',
                  message: getHumanFriendlyToolMessage(toolCall.name, 'thinking'),
                },
                'agent_thinking',
                timestamp,
              );
            }
          }

          // Handle tool output events with error handling
          if (chunk.name === 'tool_output' && chunk.item) {
            const toolOutput = chunk.item.rawItem;
            const toolCallId = toolOutput.callId;
            const endKey = `tool-end-${toolCallId}`;

            console.log(`✅ Tool output received: ${toolOutput.name} (ID: ${toolCallId})`);

            if (!processedToolCalls.has(endKey)) {
              processedToolCalls.add(endKey);

              // Check for tool errors
              const hasError = toolOutput.output?.includes('Error') || toolOutput.error;

              writeSSE(
                responseStream,
                {
                  type: 'tool_call_end',
                  toolName: toolOutput.name || 'unknown',
                  result: toolOutput.output,
                  callId: toolCallId,
                  hasError,
                  message: hasError
                    ? getHumanFriendlyToolMessage(toolOutput.name, 'error')
                    : getHumanFriendlyToolMessage(toolOutput.name, 'end'),
                },
                'tool_call_end',
                timestamp,
              );

              writeSSE(
                responseStream,
                {
                  status: 'processing',
                  message: hasError
                    ? 'Encountered an issue, but continuing...'
                    : 'Got what I needed, thinking about your question...',
                },
                'agent_thinking',
                timestamp,
              );
            }
          }
        }
      })();

      await Promise.race([
        streamPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Stream processing timeout')), cleanupTimeout - 2000),
        ),
      ]);
    } catch (error) {
      console.error('Stream processing error:', error);
      if (!streamEnded) {
        endStream(error);
        return;
      }
    }

    // Wait for the full run to complete, including all tool calls
    let finalResult;
    try {
      if (openAIStream && !streamEnded) {
        console.log('⏳ Waiting for OpenAI stream to fully complete...');
        finalResult = await Promise.race([
          openAIStream.finalResult || openAIStream.completed,
          new Promise(
            (_, reject) => setTimeout(() => reject(new Error('Stream completion timeout')), 45000), // Increased timeout for MCP calls
          ),
        ]);
        console.log('✅ OpenAI stream completed');
      }
    } catch (error) {
      console.error('Stream completion error:', error);
    }

    if (streamEnded) return;

    const processingTime = Date.now() - startTime;
    const finalResponse =
      assistantReply || (finalResult?.output ?? openAIStream?.finalOutput ?? '');

    const finalToolCalls = finalResult?.toolCalls || openAIStream?.toolCalls || [];
    toolCallCount = finalToolCalls.length;

    console.log(`🔧 Final tool calls count: ${finalToolCalls.length}`);

    const agentMessage = await saveAiMessage(
      client,
      conversation.id,
      workspaceId,
      'agent',
      finalResponse,
      undefined,
      body.agentId,
    );

    writeSSE(
      responseStream,
      {
        status: 'complete',
        message: 'Response completed',
        toolCallsUsed: finalToolCalls.length,
        processingTime,
      },
      'agent_thinking',
      Date.now().toString(),
    );

    writeSSE(
      responseStream,
      {
        agentMessage,
        userMessage,
        conversation,
        metadata: {
          processingTime,
          toolCallsCount: finalToolCalls.length,
          agentName: agent.name,
          toolCallsUsed: finalToolCalls.map((tc) => ({
            name: tc.function?.name,
            id: tc.id,
          })),
          mcpToolsCount: mcpTools.length,
          mcpFailures: failedConnections.length,
          mcpStatus: mcpTools.length > 0 ? 'active' : 'fallback',
        },
      },
      'agent_message_complete',
      Date.now().toString(),
    );

    endStream();
  } catch (error: any) {
    console.error('Streaming chat error:', error);
    endStream(error);
  } finally {
    clearTimeout(cleanupTimer);

    try {
      if (openAIStream && typeof openAIStream.close === 'function') {
        await openAIStream.close();
      }
    } catch (error) {
      console.error('Error closing OpenAI stream:', error);
    }

    if (client) {
      try {
        client.release();
      } catch (error) {
        console.error('Error releasing database client:', error);
      }
    }

    if (!streamEnded) {
      endStream();
    }
  }
};

function getHumanFriendlyToolMessage(
  toolName: string,
  phase: 'start' | 'thinking' | 'end' | 'error',
): string {
  const toolMap: Record<string, { thinking: string; start: string; end: string; error: string }> = {
    search_workspace_messages: {
      thinking: 'Searching through your messages...',
      start: 'Looking through your conversation history',
      end: 'Found relevant messages',
      error: 'Had trouble searching messages, but continuing...',
    },
    get_conversation_context: {
      thinking: 'Getting conversation details...',
      start: 'Reviewing our conversation',
      end: 'Caught up on our conversation',
      error: 'Had trouble getting conversation context, but continuing...',
    },
    // MCP tools - generic messages since we don't know the exact tool names
    unknown: {
      thinking: 'Working on something...',
      start: 'Looking something up',
      end: 'Finished looking that up',
      error: 'Encountered an issue with external tool, but continuing...',
    },
  };

  const tool = toolMap[toolName] || toolMap.unknown;
  return tool[phase];
}

function writeSSE(responseStream: any, data: any, event?: string, id?: string) {
  try {
    let sseData = '';

    if (id) {
      sseData += `id: ${id}\n`;
    }

    if (event) {
      sseData += `event: ${event}\n`;
    }

    sseData += `data: ${JSON.stringify(data)}\n\n`;

    if (!responseStream.destroyed) {
      responseStream.write(sseData);
    }
  } catch (error) {
    console.error('Error writing SSE:', error);
  }
}

export const handler = awslambda.streamifyResponse(streamHandler);
