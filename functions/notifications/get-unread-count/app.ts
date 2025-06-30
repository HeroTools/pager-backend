import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import dbPool from './utils/create-db-pool';
import { getUserIdFromToken } from './helpers/auth';
import { errorResponse, setCorsHeaders, successResponse } from './utils/response';
import { getWorkspaceMember } from './helpers/get-member';

const pathParamsSchema = z.object({
    workspaceId: z.string().uuid('workspaceId is required'),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers.Origin || event.headers.origin;
    const corsHeaders = setCorsHeaders(origin, 'GET');

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

        const unreadCountQuery = `
            SELECT COUNT(*) as unread_count 
            FROM notifications n
            WHERE n.workspace_member_id = $1 AND n.workspace_id = $2 AND n.is_read = false
        `;

        const { rows: unreadRows } = await client.query(unreadCountQuery, [member.id, workspaceId]);
        const unreadCount = parseInt(unreadRows[0].unread_count, 10);

        return successResponse(
            {
                unread_count: unreadCount,
            },
            200,
            corsHeaders,
        );
    } catch (error) {
        console.error('Error fetching unread count:', error);

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
