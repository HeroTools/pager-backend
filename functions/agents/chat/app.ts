import { run } from '@openai/agents';
import { APIGatewayProxyHandler } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { withCors } from '../../common/utils/cors';
import dbPool from '../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../common/utils/response';
import { conversationAgent } from './agents';
import { getOrCreateConversation, saveAiMessage } from './helpers/database-helpers';

const ChatRequest = z.object({
  message: z.string().min(1),
  conversationId: z.string().uuid().optional(),
  stream: z.boolean().default(false),
});

export const handler: APIGatewayProxyHandler = withCors(async (event, _ctx) => {
  let client = await dbPool.connect();
  try {
    const userId = await getUserIdFromToken(event.headers.Authorization);
    const workspaceId = event.pathParameters?.workspaceId;

    if (!userId || !workspaceId) {
      return errorResponse('Missing required parameters', 400);
    }

    const body = ChatRequest.parse(JSON.parse(event.body || '{}'));

    const conversation = await getOrCreateConversation(
      client,
      workspaceId,
      userId,
      body.conversationId,
    );

    console.log('Conversation', conversation);

    // Persist user message
    await saveAiMessage(client, conversation.id, workspaceId, 'user', body.message);

    if (body.stream) {
      // For streaming response via Lambda + API Gateway
      return await handleStreamingResponse(client, conversation, workspaceId, userId, body.message);
    } else {
      // Non-streaming response
      return await handleRegularResponse(client, conversation, workspaceId, userId, body.message);
    }
  } catch (error: any) {
    console.error('Chat handler error:', error);
    return errorResponse(error.message || 'Internal server error', 500);
  } finally {
    if (client) {
      client.release();
    }
  }
});

async function handleRegularResponse(
  client: PoolClient,
  conversation: any,
  workspaceId: string,
  userId: string,
  message: string,
) {
  const result = await run(
    conversationAgent,
    [
      {
        role: 'system',
        content: `Current conversation_id: ${conversation.id}. Always use this ID when calling get_conversation_context.`,
      },
      {
        role: 'user',
        content: message,
      },
    ],
    {
      context: {
        workspaceId,
        userId,
        conversation_id: conversation.id,
      },
    },
  );

  console.log(result);

  // Save assistant response
  await saveAiMessage(client, conversation.id, workspaceId, 'assistant', result.finalOutput, {
    agentTrace: result.trace,
    toolCalls: result.toolCalls || [],
  });

  return successResponse({
    response: result.finalOutput,
    conversationId: conversation.id,
    agentTrace: result.trace,
    toolsUsed: result.toolCalls?.length || 0,
  });
}

async function handleStreamingResponse(
  client: PoolClient,
  conversation: any,
  workspaceId: string,
  userId: string,
  message: string,
) {
  // For Lambda streaming, we need to collect the response and return it
  // True streaming requires WebSocket or Server-Sent Events setup
  let assistantReply = '';
  const chunks: string[] = [];

  const result = await run(conversationAgent, message, {
    stream: true,
    context: {
      workspaceId,
      userId,
      conversationId: conversation.id,
    },
    onEvent(event: { type: string; data: any }) {
      if (event.type === 'response_stream' || event.type === 'content_delta') {
        const chunk = event.data?.content || event.data || '';
        assistantReply += chunk;
        chunks.push(chunk);
        // In a WebSocket setup, you'd send each chunk immediately
        // For HTTP, we collect and return the complete response
      }
    },
  });

  // Use the final output if streaming didn't capture everything
  const finalResponse = assistantReply || result.finalOutput;

  // Save final assistant message
  await saveAiMessage(client, conversation.id, workspaceId, 'assistant', finalResponse, {
    agentTrace: result.trace,
    toolCalls: result.toolCalls || [],
    streamChunks: chunks.length,
  });

  // Return with streaming headers for future WebSocket upgrade
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      'X-Streaming-Supported': 'true',
    },
    body: JSON.stringify({
      response: finalResponse,
      conversationId: conversation.id,
      agentTrace: result.trace,
      toolsUsed: result.toolCalls?.length || 0,
      streaming: true,
    }),
  };
}
