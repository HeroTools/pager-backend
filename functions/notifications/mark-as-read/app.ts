import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import dbPool from './utils/create-db-pool';
import { getUserIdFromToken } from './helpers/auth';
import { errorResponse, setCorsHeaders, successResponse } from './utils/response';
import { getWorkspaceMember } from './helpers/get-member';

const PathParamsSchema = z.object({
    workspaceId: z.string().uuid('workspaceId is required'),
});

const BodySchema = z.object({
    notificationIds: z.array(z.string().uuid('notificationIds is required')).min(1),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers.Origin || event.headers.origin;
    const corsHeaders = setCorsHeaders(origin, 'PATCH');

    if (event.httpMethod === 'OPTIONS') {
        return successResponse({ message: 'OK' }, 200, corsHeaders);
    }

    let client: PoolClient | null = null;
    try {
        const pathResult = PathParamsSchema.safeParse(event.pathParameters);
        if (!pathResult.success) {
            return errorResponse(
                `Invalid path parameters: ${pathResult.error.errors.map((e) => e.message).join(', ')}`,
                400,
                corsHeaders,
            );
        }
        const { workspaceId } = pathResult.data;

        const userId = await getUserIdFromToken(event.headers.Authorization);
        if (!userId) {
            return errorResponse('Unauthorized', 401, corsHeaders);
        }
        if (!event.body) {
            return errorResponse('Missing request body', 400, corsHeaders);
        }
        const bodyResult = BodySchema.safeParse(JSON.parse(event.body));
        if (!bodyResult.success) {
            return errorResponse(
                `Invalid body: ${bodyResult.error.errors.map((e) => e.message).join(', ')}`,
                400,
                corsHeaders,
            );
        }
        const { notificationIds } = bodyResult.data;

        client = await dbPool.connect();

        const member = await getWorkspaceMember(client, workspaceId, userId);
        if (!member?.id) {
            return errorResponse('Not a member of this workspace', 403, corsHeaders);
        }
        const selectSql = `
            SELECT n.id, n.is_read
            FROM notifications n
            JOIN workspace_members wm 
                ON n.workspace_member_id = wm.id
            WHERE n.id = ANY($1)
                AND wm.user_id = $2
                AND wm.is_deactivated = false
                AND n.workspace_id = $3
        `;
        const { rows: found } = await client.query(selectSql, [notificationIds, userId, workspaceId]);

        if (found.length === 0) {
            return errorResponse('No matching notifications found', 404, corsHeaders);
        }

        const updateSql = `
            UPDATE notifications
            SET is_read = true,
                read_at  = NOW(),
                updated_at = NOW()
            WHERE id = ANY($1)
                AND workspace_id = $2
                AND workspace_member_id = $3
            RETURNING id, is_read, read_at
        `;
        const { rows: updated } = await client.query(updateSql, [notificationIds, workspaceId, member.id]);

        return successResponse(
            {
                updated: updated.map((r) => ({
                    id: r.id,
                    is_read: r.is_read,
                    read_at: r.read_at,
                })),
                message: 'Notifications marked as read successfully',
            },
            200,
            corsHeaders,
        );
    } catch (err) {
        console.error('Error marking notifications:', err);
        if (err instanceof z.ZodError) {
            return errorResponse(`Validation error: ${err.errors.map((e) => e.message).join(', ')}`, 400, corsHeaders);
        }
        return errorResponse('Internal server error', 500, corsHeaders);
    } finally {
        if (client) {
            try {
                await client.release();
            } catch (e) {
                console.error('Error releasing client:', e);
            }
        }
    }
};
