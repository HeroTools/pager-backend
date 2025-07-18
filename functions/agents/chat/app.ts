import { run } from '@openai/agents';
import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../common/helpers/auth';
import dbPool from '../../common/utils/create-db-pool';
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
  let sseData = '';

  if (id) {
    sseData += `id: ${id}\n`;
  }

  if (event) {
    sseData += `event: ${event}\n`;
  }

  sseData += `data: ${JSON.stringify(data)}\n\n`;
  responseStream.write(sseData);
}

export const streamHandler = async (
  event: APIGatewayProxyEventV2,
  responseStream: any,
  context: Context,
) => {
  let client: PoolClient | null = null;

  responseStream.setContentType('text/event-stream');

  try {
    const requestBody = JSON.parse(event.body || '{}');
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const workspaceId = event.pathParameters?.workspaceId || requestBody.workspaceId;

    if (!authHeader || !workspaceId) {
      writeSSE(responseStream, { error: 'Missing required parameters' }, 'error');
      return;
    }

    const body = ChatRequest.parse(requestBody);

    client = await dbPool.connect();
    const userId = await getUserIdFromToken(authHeader);

    if (!userId) {
      writeSSE(responseStream, { error: 'Unauthorized' }, 'error');
      return;
    }

    const workspaceMemberResult = await client.query(
      `SELECT id FROM workspace_members
       WHERE user_id = $1 AND workspace_id = $2 AND is_deactivated = false`,
      [userId, workspaceId],
    );

    if (workspaceMemberResult.rows.length === 0) {
      writeSSE(responseStream, { error: 'User not found in workspace' }, 'error');
      return;
    }

    const workspaceMemberId = workspaceMemberResult.rows[0].id;

    const agentResult = await client.query(
      `SELECT id, name, system_prompt FROM agents
       WHERE id = $1 AND workspace_id = $2 AND is_active = true`,
      [body.agentId, workspaceId],
    );

    if (agentResult.rows.length === 0) {
      writeSSE(responseStream, { error: 'Agent not found or inactive' }, 'error');
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

    const stream = await run(
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
    );

    let assistantReply = '';
    let toolCallCount = 0;
    let hasStartedGenerating = false;

    // Track processed text deltas to avoid duplicates
    const processedTextDeltas = new Set();
    const processedToolCalls = new Set();
    const processedThinkingEvents = new Set();

    // Process the main stream - handle all the different event types
    try {
      for await (const chunk of stream) {
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
              // Create very specific unique key for each text delta
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
                  console.log('Backend sending delta:', JSON.stringify(textDelta));
                  writeSSE(responseStream, { content: textDelta }, 'content_delta', timestamp);
                }
              }
              break;

            case 'response.function_call_arguments.delta':
              // Only send this once per function call
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

        // SKIP the alternative output_text_delta format to avoid duplicates
        // We'll only process the raw_model_stream_event version above

        // Handle tool called events
        if (chunk.name === 'tool_called' && chunk.item) {
          const toolCall = chunk.item.rawItem;
          const toolCallId = toolCall.callId;
          const startKey = `tool-start-${toolCallId}`;

          // Avoid duplicate tool call start events
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

            // Also send thinking status
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

          // Avoid duplicate tool call end events
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

            // Update thinking status
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
    } catch (error) {
      console.error('Stream processing error:', error);
    }

    // Wait for the stream to complete
    try {
      await stream.completed;
    } catch (error) {
      console.error('Stream completion error:', error);
    }

    const processingTime = Date.now() - startTime;
    const finalResponse = assistantReply || stream.finalOutput;

    // Get final tool calls information
    const finalToolCalls = stream.toolCalls || [];
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

    writeSSE(responseStream, { status: 'complete' }, 'done');
    responseStream.end();
  } catch (error: any) {
    console.error('Streaming chat error:', error);
    writeSSE(responseStream, { message: error.message || 'Internal server error' }, 'error');
    responseStream.end();
  } finally {
    if (client) {
      client.release();
    }
  }
};

export const handler = awslambda.streamifyResponse(streamHandler);
