import { run } from '@openai/agents';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import dbPool from '../../../common/utils/create-db-pool';
import { conversationAgent } from './agents';
import { getOrCreateConversation, saveAiMessage } from './helpers/database-helpers';

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

function getHumanFriendlyToolMessage(
  toolName: string,
  phase: 'start' | 'thinking' | 'end',
): string {
  const toolMap: Record<string, { thinking: string; start: string; end: string }> = {
    search_workspace_messages: {
      thinking: 'Searching through your messages...',
      start: 'Looking through your conversation history',
      end: 'Found relevant messages',
    },
    get_conversation_context: {
      thinking: 'Getting conversation details...',
      start: 'Reviewing our conversation',
      end: 'Caught up on our conversation',
    },
    search_workspace_channels: {
      thinking: 'Searching through channels...',
      start: 'Looking through your channels',
      end: 'Found channel information',
    },
    get_workspace_members: {
      thinking: 'Looking up team members...',
      start: "Checking who's in your workspace",
      end: 'Found team member information',
    },
    create_message: {
      thinking: 'Creating a message...',
      start: 'Writing a message',
      end: 'Message created',
    },
    unknown: {
      thinking: 'Working on something...',
      start: 'Looking something up',
      end: 'Finished looking that up',
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

export const streamHandler = async (
  event: APIGatewayProxyEventV2,
  responseStream: any,
  context: Context,
) => {
  let client: PoolClient | null = null;
  let openAIStream: any = null;
  let streamEnded = false;

  const originalTimeout = context.getRemainingTimeInMillis();
  const cleanupTimeout = originalTimeout - 4000; // Reserve 4s for cleanup, max 300s total

  responseStream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });

  // Ensure stream ends properly in all scenarios
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

  // Set cleanup timeout
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

    // Get database connection with timeout
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

    // Emit thinking started event
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

    // Create OpenAI stream with timeout
    try {
      openAIStream = await Promise.race([
        run(
          conversationAgent,
          [
            {
              role: 'system',
              content: `You are ${agent.name}. ${agent.system_prompt || ''}. Current conversation_id: ${conversation.id}. Always use this ID when calling get_conversation_context.`,
            },
            {
              role: 'user',
              content: body.message,
            },
          ],
          {
            stream: true,
            context: {
              workspaceId,
              userId,
              conversation_id: conversation.id,
              agentId: body.agentId,
            },
          },
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('OpenAI stream creation timeout')), 10000),
        ),
      ]);
    } catch (error) {
      console.error('❌ OpenAI stream creation failed:', error);
      endStream(error);
      return;
    }

    let assistantReply = '';
    let toolCallCount = 0;
    let hasStartedGenerating = false;

    // Track processed text deltas to avoid duplicates
    const processedTextDeltas = new Set();
    const processedToolCalls = new Set();
    const processedThinkingEvents = new Set();

    // Process the main stream with proper error handling and timeout
    try {
      const streamPromise = (async () => {
        for await (const chunk of openAIStream) {
          // Check if we should stop processing
          if (streamEnded) {
            console.log('Stream processing stopped due to cleanup');
            break;
          }

          const timestamp = Date.now().toString();

          // Handle raw model stream events (prioritize this format)
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

          // Handle tool called events
          if (chunk.name === 'tool_called' && chunk.item) {
            const toolCall = chunk.item.rawItem;
            const toolCallId = toolCall.callId;
            const startKey = `tool-start-${toolCallId}`;

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

          // Handle tool output events
          if (chunk.name === 'tool_output' && chunk.item) {
            const toolOutput = chunk.item.rawItem;
            const toolCallId = toolOutput.callId;
            const endKey = `tool-end-${toolCallId}`;

            if (!processedToolCalls.has(endKey)) {
              processedToolCalls.add(endKey);

              writeSSE(
                responseStream,
                {
                  type: 'tool_call_end',
                  toolName: toolOutput.name || 'unknown',
                  result: toolOutput.output,
                  callId: toolCallId,
                  message: getHumanFriendlyToolMessage(toolOutput.name, 'end'),
                },
                'tool_call_end',
                timestamp,
              );

              writeSSE(
                responseStream,
                {
                  status: 'processing',
                  message: 'Got what I needed, thinking about your question...',
                },
                'agent_thinking',
                timestamp,
              );
            }
          }
        }
      })();

      // Wait for stream processing with timeout
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

    // Wait for the stream to complete with timeout
    try {
      if (openAIStream && !streamEnded) {
        await Promise.race([
          openAIStream.completed,
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Stream completion timeout')), 5000),
          ),
        ]);
      }
    } catch (error) {
      console.error('Stream completion error:', error);
    }

    if (streamEnded) return;

    const processingTime = Date.now() - startTime;
    const finalResponse = assistantReply || (openAIStream?.finalOutput ?? '');

    // Get final tool calls information
    const finalToolCalls = openAIStream?.toolCalls || [];
    toolCallCount = finalToolCalls.length;

    const agentMessage = await saveAiMessage(
      client,
      conversation.id,
      workspaceId,
      'agent',
      finalResponse,
      undefined,
      body.agentId,
    );

    // Send completion thinking event
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

    // Send final completion with all the data needed for cache updates
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
    // Clear the cleanup timer
    clearTimeout(cleanupTimer);

    // Cleanup resources
    try {
      // Close OpenAI stream if it exists
      if (openAIStream && typeof openAIStream.close === 'function') {
        await openAIStream.close();
      }
    } catch (error) {
      console.error('Error closing OpenAI stream:', error);
    }

    // Release database connection
    if (client) {
      try {
        client.release();
      } catch (error) {
        console.error('Error releasing database client:', error);
      }
    }

    // Ensure stream is ended
    if (!streamEnded) {
      endStream();
    }
  }
};

export const handler = awslambda.streamifyResponse(streamHandler);
