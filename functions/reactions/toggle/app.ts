import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { successResponse, errorResponse } from '../../common/utils/response';
import dbPool from '../../common/utils/create-db-pool';
import { getWorkspaceMember } from '../../common/helpers/get-member';
import { verifyMessageInWorkspace } from './helpers/verify-message';
import { withCors } from '../../common/utils/cors';

const PathParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
  messageId: z.string().uuid('Invalid message ID format'),
});

const ReactionRequestSchema = z.object({
  action: z.enum(['add', 'remove'], {
    errorMap: () => ({ message: 'Action must be "add" or "remove"' }),
  }),
  value: z
    .string()
    .min(1, 'Reaction value cannot be empty')
    .max(10, 'Reaction value too long')
    .regex(
      /^[\p{Emoji}\p{Emoji_Modifier}\p{Emoji_Component}\p{Emoji_Modifier_Base}\p{Emoji_Presentation}]+$/u,
      'Invalid emoji format',
    ),
});

interface ReactionRequest {
  action: 'add' | 'remove';
  value: string;
}

interface ReactionResponse {
  success: boolean;
  reaction?: {
    id: string;
    value: string;
    createdAt: string;
  };
  error?: string;
}

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client;

    try {
      const pathParams = PathParamsSchema.parse(event.pathParameters);
      const { workspaceId, messageId } = pathParams;

      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      client = await dbPool.connect();

      const workspaceMember = await getWorkspaceMember(client, workspaceId, userId);
      if (!workspaceMember) {
        return errorResponse('User not found in workspace', 403);
      }

      if (event.httpMethod !== 'POST') {
        return errorResponse('Method not allowed', 405);
      }

      if (!event.body) {
        return errorResponse('Request body is required', 400);
      }

      const request = ReactionRequestSchema.parse(JSON.parse(event.body));
      const { action } = request;

      const messageExists = await verifyMessageInWorkspace(client, messageId, workspaceId);
      if (!messageExists) {
        return errorResponse('Message not found in workspace', 404);
      }

      let response: ReactionResponse;

      if (action === 'add') {
        response = await addReaction(client, {
          ...request,
          workspaceId,
          workspaceMemberId: workspaceMember.id,
          messageId,
        });
      } else {
        response = await removeReaction(client, {
          ...request,
          workspaceId,
          workspaceMemberId: workspaceMember.id,
          messageId,
        });
      }

      return successResponse(response, 200);
    } catch (error) {
      console.error('Lambda error:', error);

      if (error instanceof z.ZodError) {
        const errorMessages = error.errors
          .map((err) => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        return errorResponse(`Validation error: ${errorMessages}`, 400);
      }
      if (error instanceof SyntaxError) {
        return errorResponse('Invalid JSON in request body', 400);
      }

      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);

async function addReaction(
  client: any,
  request: ReactionRequest & { workspaceId: string; workspaceMemberId: string; messageId: string },
): Promise<ReactionResponse> {
  const { messageId, workspaceMemberId, workspaceId, value } = request;

  try {
    const result = await client.query(
      `INSERT INTO reactions (workspace_id, message_id, workspace_member_id, value)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (workspace_id, message_id, workspace_member_id, value) 
             DO NOTHING
             RETURNING id, value, created_at`,
      [workspaceId, messageId, workspaceMemberId, value],
    );

    if (result.rows.length === 0) {
      // Reaction already exists
      return {
        success: true,
        reaction: undefined,
      };
    }

    const reaction = result.rows[0];
    return {
      success: true,
      reaction: {
        id: reaction.id,
        value: reaction.value,
        createdAt: reaction.created_at,
      },
    };
  } catch (error: any) {
    if (error.code === '23503') {
      return {
        success: false,
        error: 'Invalid message, workspace member, or workspace ID',
      };
    }

    console.error('Add reaction error:', error);
    return {
      success: false,
      error: 'Failed to add reaction',
    };
  }
}

async function removeReaction(
  client: any,
  request: ReactionRequest & { workspaceId: string; workspaceMemberId: string; messageId: string },
): Promise<ReactionResponse> {
  const { messageId, workspaceMemberId, workspaceId, value } = request;

  try {
    const result = await client.query(
      `DELETE FROM reactions 
             WHERE workspace_id = $1 
               AND message_id = $2 
               AND workspace_member_id = $3 
               AND value = $4
             RETURNING id, value, created_at`,
      [workspaceId, messageId, workspaceMemberId, value],
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        error: 'Reaction not found',
      };
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error('Remove reaction error:', error);
    return {
      success: false,
      error: 'Failed to remove reaction',
    };
  }
}
