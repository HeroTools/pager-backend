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

    // Use the text stream for real-time content (this is what gives us streaming)
    const textStream = stream.toTextStream();

    try {
      for await (const chunk of textStream) {
        assistantReply += chunk;
        // Send each chunk immediately for real-time streaming
        writeSSE(responseStream, { content: chunk }, 'content_delta', Date.now().toString());
      }
    } catch (error) {
      console.error('Text streaming error:', error);
    }

    // Wait for the stream to complete to get final results
    try {
      await stream.completed;
    } catch (error) {
      console.error('Stream completion error:', error);
    }

    await stream.completed;

    const processingTime = Date.now() - startTime;
    const finalResponse = assistantReply || stream.finalOutput;

    const agentMessage = await saveAiMessage(
      client,
      conversation.id,
      workspaceId,
      'agent',
      finalResponse,
      undefined,
      body.agentId,
    );

    // Send final completion with all the data needed for cache updates
    writeSSE(
      responseStream,
      {
        agentMessage,
        userMessage, // Include this for cache consistency
        conversation,
        metadata: {
          processingTime,
          toolCallsCount: stream.toolCalls?.length || 0,
          agentName: agent.name,
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
