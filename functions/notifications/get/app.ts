import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import dbPool from './utils/create-db-pool';
import { getUserIdFromToken } from './helpers/auth';
import { errorResponse, setCorsHeaders, successResponse } from './utils/response';
import { getWorkspaceMember } from './helpers/get-member';

const QueryParamsSchema = z.object({
    limit: z
        .string()
        .optional()
        .transform((val) => (val ? Math.min(parseInt(val, 10), 100) : 50)),
    cursor: z.string().optional(),
    unreadOnly: z
        .string()
        .optional()
        .transform((val) => val === 'true'),
});

const pathParamsSchema = z.object({
    workspaceId: z.string().uuid(),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers.Origin || event.headers.origin;
    const corsHeaders = setCorsHeaders(origin, 'POST');

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

        const queryParamsResult = QueryParamsSchema.safeParse(event.queryStringParameters || {});
        if (!queryParamsResult.success) {
            return errorResponse(
                `Invalid query parameters: ${queryParamsResult.error.errors.map((e) => e.message).join(', ')}`,
                400,
                corsHeaders,
            );
        }

        const { limit, cursor, unreadOnly } = queryParamsResult.data;

        const userId = await getUserIdFromToken(event.headers.Authorization);
        if (!userId) {
            return errorResponse('Unauthorized', 401, corsHeaders);
        }

        client = await dbPool.connect();

        const member = await getWorkspaceMember(client, workspaceId, userId);

        if (!member?.id) {
            return errorResponse('Not a member of this workspace', 403, corsHeaders);
        }

        let whereClause = 'WHERE n.workspace_member_id = $1 AND n.workspace_id = $2';
        const queryParams: any[] = [member.id, workspaceId];
        let paramIndex = 3;

        if (unreadOnly) {
            whereClause += ` AND n.is_read = false`;
        }

        if (cursor) {
            whereClause += ` AND n.created_at < $${paramIndex}`;
            queryParams.push(cursor);
            paramIndex++;
        }

        const notificationsQuery = `
            SELECT 
                n.id,
                n.workspace_id,
                n.type,
                n.title,
                n.message,
                n.is_read,
                n.read_at,
                n.created_at,
                n.related_message_id,
                n.related_channel_id,
                n.related_conversation_id,
                n.workspace_member_id,
                n.sender_workspace_member_id,
                c.name as channel_name
            FROM notifications n
            LEFT JOIN channels c ON n.related_channel_id = c.id
            ${whereClause}
            ORDER BY n.created_at DESC
            LIMIT $${paramIndex}
        `;

        queryParams.push(limit + 1);

        const { rows: notifications } = await client.query(notificationsQuery, queryParams);

        const hasMore = notifications.length > limit;
        const resultNotifications = hasMore ? notifications.slice(0, limit) : notifications;

        const nextCursor =
            resultNotifications.length > 0 ? resultNotifications[resultNotifications.length - 1].created_at : null;

        const unreadCountQuery = `
            SELECT COUNT(*) as unread_count
            FROM notifications n
            WHERE n.workspace_member_id = $1 AND n.workspace_id = $2 AND n.is_read = false
        `;

        const { rows: unreadRows } = await client.query(unreadCountQuery, [member.id, workspaceId]);
        const unreadCount = parseInt(unreadRows[0].unread_count, 10);

        const transformedNotifications = resultNotifications.map((notification) => ({
            id: notification.id,
            type: notification.type,
            title: notification.title,
            message: notification.message,
            is_read: notification.is_read,
            read_at: notification.read_at,
            created_at: notification.created_at,
            workspace_id: notification.workspace_id,
            related_message_id: notification.related_message_id,
            related_channel_id: notification.related_channel_id,
            related_conversation_id: notification.related_conversation_id,
            workspace_member_id: notification.workspace_member_id,
            sender_workspace_member_id: notification.sender_workspace_member_id,
            channel_name: notification.channel_name,
        }));

        return successResponse(
            {
                notifications: transformedNotifications,
                pagination: {
                    limit,
                    cursor,
                    nextCursor,
                    hasMore,
                },
                unread_count: unreadCount,
            },
            200,
            corsHeaders,
        );
    } catch (error) {
        console.error('Error fetching notifications:', error);

        if (error instanceof z.ZodError) {
            return errorResponse(
                `Validation error: ${error.errors.map((e) => e.message).join(', ')}`,
                400,
                corsHeaders,
            );
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
