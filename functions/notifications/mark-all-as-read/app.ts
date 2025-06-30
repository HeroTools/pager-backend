import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import dbPool from './utils/create-db-pool';
import { getUserIdFromToken } from './helpers/auth';
import { errorResponse, setCorsHeaders, successResponse } from './utils/response';
import { getWorkspaceMember } from './helpers/get-member';

const pathParamsSchema = z.object({
    workspaceId: z.string().uuid(),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers.Origin || event.headers.origin;
    const corsHeaders = setCorsHeaders(origin, 'PATCH');

    if (event.httpMethod === 'OPTIONS') {
        return successResponse({ message: 'OK' }, 200, corsHeaders);
    }
    let client: PoolClient | null = null;

    try {
        const pathParamsResult = pathParamsSchema.safeParse(event.pathParameters || {});
        if (!pathParamsResult.success) {
            return errorResponse(
                `Invalid path parameters: ${pathParamsResult.error.errors.map((e) => e.message).join(', ')}`,
                400,
                corsHeaders,
            );
        }

        const { workspaceId } = pathParamsResult.data;

        const userId = await getUserIdFromToken(event.headers.Authorization);
        if (!userId) {
            return errorResponse('Unauthorized', 401, corsHeaders);
        }

        client = await dbPool.connect();

        const member = await getWorkspaceMember(client, workspaceId, userId);
        if (!member?.id) {
            return errorResponse('Not a member of this workspace', 403, corsHeaders);
        }

        const countQuery = `
            SELECT COUNT(*) as unread_count
            FROM notifications n
            WHERE n.workspace_member_id = $1 AND n.workspace_id = $2 AND n.is_read = false
        `;

        const { rows: countRows } = await client.query(countQuery, [member.id, workspaceId]);
        const unreadCount = parseInt(countRows[0].unread_count, 10);

        if (unreadCount === 0) {
            return successResponse(
                {
                    updated_count: 0,
                    message: 'No unread notifications to update',
                },
                200,
                corsHeaders,
            );
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

        return successResponse(
            {
                updated_count: updatedRows.length,
                updated_notification_ids: updatedRows.map((row) => row.id),
                message: `Successfully marked ${updatedRows.length} notifications as read`,
            },
            200,
            corsHeaders,
        );
    } catch (error) {
        console.error('Error marking all notifications as read:', error);

        if (error instanceof z.ZodError) {
            return errorResponse(
                `Validation error: ${error.errors.map((e) => e.message).join(', ')}`,
                400,
                corsHeaders,
            );
        }

        if (error instanceof SyntaxError) {
            return errorResponse('Invalid JSON in request body', 400, corsHeaders);
        }

        return errorResponse('Internal server error', 500, corsHeaders);
    } finally {
        if (client) {
            try {
                client.release();
            } catch (releaseError) {
                console.error('Error releasing database connection:', releaseError);
            }
        }
    }
};
