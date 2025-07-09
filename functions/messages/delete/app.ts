import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { errorResponse, successResponse } from '../../common/utils/response';
import dbPool from '../../common/utils/create-db-pool';
import { validateMessageAccess } from './helpers/validate-member-access';
import { softDeleteOnlyParent } from './helpers/soft-delete-parent-message';
import { broadcastMessageDelete } from './helpers/broadcasting';
import { withCors } from '../../common/utils/cors';

const pathParamsSchema = z.object({
  messageId: z.string().uuid('Invalid message ID format'),
  workspaceId: z.string().uuid('Invalid workspace ID format'),
});

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client: PoolClient | null = null;
    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const paramsParse = pathParamsSchema.safeParse(event.pathParameters ?? {});
      if (!paramsParse.success) {
        const err = paramsParse.error.errors[0];
        return errorResponse(`Validation error: ${err.message}`, 400);
      }
      const { messageId, workspaceId } = paramsParse.data;

      console.log(`[handler] User ${userId} deleting message ${messageId}`);

      client = await dbPool.connect();
      const access = await validateMessageAccess(client, messageId, userId, workspaceId);
      if (!access) {
        return errorResponse('Message not found or access denied', 404);
      }
      if (!access.canDelete) {
        const msg =
          access.currentMember.role === 'admin'
            ? 'Admin deletion failed – contact support'
            : 'Can only delete your own messages or be an admin';
        return errorResponse(msg, 403);
      }

      const deletedAt = new Date().toISOString();
      const result = await softDeleteOnlyParent(client, messageId, deletedAt);

      await broadcastMessageDelete(
        workspaceId,
        messageId,
        access.message.parent_message_id,
        access.message.channel_id,
        access.message.conversation_id,
      );

      return successResponse(result, 200);
    } catch (err) {
      console.error('[handler] Error:', err);

      if (err instanceof z.ZodError) {
        const messages = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`);
        return errorResponse(`Validation failed: ${messages.join(', ')}`, 400);
      }

      const msg = err instanceof Error ? err.message : 'Unknown error';
      if (msg.includes('not found') || msg.includes('already deleted')) {
        return errorResponse('Message not found', 404);
      }

      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
