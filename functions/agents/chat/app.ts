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
  agentId: z.string().uuid().describe('The AI agent to chat with'),
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

    // Get user's workspace member ID
    const workspaceMemberResult = await client.query(
      `SELECT id FROM workspace_members
       WHERE user_id = $1 AND workspace_id = $2 AND is_deactivated = false`,
      [userId, workspaceId],
    );

    if (workspaceMemberResult.rows.length === 0) {
      return errorResponse('User not found in workspace', 403);
    }

    const workspaceMemberId = workspaceMemberResult.rows[0].id;

    // Verify agent exists and is active in this workspace
    const agentResult = await client.query(
      `SELECT id, name, system_prompt FROM agents
       WHERE id = $1 AND workspace_id = $2 AND is_active = true`,
      [body.agentId, workspaceId],
    );

    if (agentResult.rows.length === 0) {
      return errorResponse('Agent not found or inactive', 404);
    }

    const agent = agentResult.rows[0];

    const conversation = await getOrCreateConversation(
      client,
      workspaceId,
      workspaceMemberId,
      body.agentId,
      body.conversationId,
    );

    console.log('Conversation', conversation);

    // Persist user message
    await saveAiMessage(
      client,
      conversation.id,
      workspaceId,
      'user',
      body.message,
      workspaceMemberId, // workspace_member_id for user message
      undefined, // ai_agent_id (null for user messages)
    );

    if (body.stream) {
      // For streaming response via Lambda + API Gateway
      return await handleStreamingResponse(
        client,
        conversation,
        workspaceId,
        userId,
        body.agentId,
        agent,
        body.message,
      );
    } else {
      // Non-streaming response
      return await handleRegularResponse(
        client,
        conversation,
        workspaceId,
        userId,
        body.agentId,
        agent,
        body.message,
      );
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
  agentId: string,
  agent: any,
  message: string,
) {
  const startTime = Date.now();

  const result = await run(
    conversationAgent,
    [
      {
        role: 'system',
        content: `You are ${agent.name}. ${agent.system_prompt || ''}. Current conversation_id: ${conversation.id}. Always use this ID when calling get_conversation_context.`,
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
        agentId,
      },
    },
  );

  const processingTime = Date.now() - startTime;

  console.log(result);

  // Save assistant response with AI-specific metadata
  await saveAiMessage(
    client,
    conversation.id,
    workspaceId,
    'agent',
    result.finalOutput,
    undefined, // workspace_member_id (null for agent messages)
    agentId, // ai_agent_id for agent messages
  );

  return successResponse({
    response: result.finalOutput,
    conversationId: conversation.id,
    agentId,
    agentName: agent.name,
    agentTrace: result.trace,
    toolsUsed: result.toolCalls?.length || 0,
    processingTimeMs: processingTime,
  });
}

async function handleStreamingResponse(
  client: PoolClient,
  conversation: any,
  workspaceId: string,
  userId: string,
  agentId: string,
  agent: any,
  message: string,
) {
  const startTime = Date.now();
  // For Lambda streaming, we need to collect the response and return it
  // True streaming requires WebSocket or Server-Sent Events setup
  let assistantReply = '';
  const chunks: string[] = [];

  const result = await run(
    conversationAgent,
    [
      {
        role: 'system',
        content: `You are ${agent.name}. ${agent.system_prompt || ''}. Current conversation_id: ${conversation.id}. Always use this ID when calling get_conversation_context.`,
      },
      {
        role: 'user',
        content: message,
      },
    ],
    {
      stream: true,
      context: {
        workspaceId,
        userId,
        conversationId: conversation.id,
        agentId,
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
    },
  );

  const processingTime = Date.now() - startTime;

  // Use the final output if streaming didn't capture everything
  const finalResponse = assistantReply || result.finalOutput;

  // Save final assistant message
  await saveAiMessage(
    client,
    conversation.id,
    workspaceId,
    'agent',
    finalResponse,
    undefined, // workspace_member_id (null for agent messages)
    agentId,
  );

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
      agentId,
      agentName: agent.name,
      agentTrace: result.trace,
      toolsUsed: result.toolCalls?.length || 0,
      processingTimeMs: processingTime,
      streaming: true,
    }),
  };
}
