import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getWorkspaceMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('workspaceId is required'),
});

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client: PoolClient | null = null;

    try {
      const pathParamsResult = pathParamsSchema.safeParse(event.pathParameters || {});
      if (!pathParamsResult.success) {
        return errorResponse(
          `Invalid path parameters: ${pathParamsResult.error.errors
            .map((e) => e.message)
            .join(', ')}`,
          400,
        );
      }

      const { workspaceId } = pathParamsResult.data;

      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      client = await dbPool.connect();

      const member = await getWorkspaceMember(client, workspaceId, userId);
      if (!member?.id) {
        return errorResponse('Not a member of this workspace', 403);
      }

      const countQuery = `
            SELECT COUNT(*) as unread_count
            FROM notifications n
            WHERE n.workspace_member_id = $1 AND n.workspace_id = $2 AND n.is_read = false
        `;

      const { rows: countRows } = await client.query(countQuery, [member.id, workspaceId]);
      const unreadCount = parseInt(countRows[0].unread_count, 10);

      if (unreadCount === 0) {
        return successResponse({
          updated_count: 0,
          message: 'No unread notifications to update',
        });
      }

      const updateQuery = `
            UPDATE notifications
            SET is_read = true, read_at = NOW(), updated_at = NOW()
            WHERE workspace_member_id = $1
              AND workspace_id = $2
              AND is_read = false
            RETURNING id
        `;

      const { rows: updatedRows } = await client.query(updateQuery, [member.id, workspaceId]);

      console.log(
        `Marked ${updatedRows.length} notifications as read for user ${userId} in workspace ${workspaceId}`,
      );

      return successResponse({
        updated_count: updatedRows.length,
        updated_notification_ids: updatedRows.map((row) => row.id),
        message: `Successfully marked ${updatedRows.length} notifications as read`,
      });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);

      if (error instanceof z.ZodError) {
        return errorResponse(
          `Validation error: ${error.errors.map((e) => e.message).join(', ')}`,
          400,
        );
      }

      if (error instanceof SyntaxError) {
        return errorResponse('Invalid JSON in request body', 400);
      }

      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.error('Error releasing database connection:', releaseError);
        }
      }
    }
  },
);
