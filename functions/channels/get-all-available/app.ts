import { APIGatewayProxyHandler } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getMember } from './helpers/get-member';
import dbPool from './utils/create-db-pool';
import { successResponse, errorResponse } from './utils/response';

export const handler: APIGatewayProxyHandler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    let client;
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const workspaceId = event.pathParameters?.workspaceId;

        if (!workspaceId) {
            return errorResponse('Workspace ID is required', 400);
        }

        const member = await getMember(workspaceId, userId);

        if (!member) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // Get all available channels (public + user's joined channels) with membership info
        const query = `
            SELECT 
                c.*,
                cm.id as member_id,
                cm.role as member_role,
                cm.joined_at as member_joined_at,
                cm.notifications_enabled as member_notifications_enabled,
                cm.last_read_message_id as member_last_read_message_id,
                CASE WHEN cm.id IS NOT NULL THEN true ELSE false END as is_member
            FROM channels c
            LEFT JOIN channel_members cm ON c.id = cm.channel_id AND cm.workspace_member_id = $2
            WHERE c.workspace_id = $1 
            AND (
                c.channel_type = 'public' 
                OR cm.workspace_member_id = $2
            )
            ORDER BY c.created_at ASC
        `;

        client = await dbPool.connect();

        const result = await client.query(query, [workspaceId, member.id]);

        // Transform the flat result into the expected structure
        const channels = result.rows.map((row) => ({
            id: row.id,
            name: row.name,
            workspace_id: row.workspace_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            channel_type: row.channel_type,
            description: row.description,
            settings: row.settings,
            is_member: row.is_member,
            member_info: row.is_member
                ? {
                      id: row.member_id,
                      role: row.member_role,
                      joined_at: row.member_joined_at,
                      notifications_enabled: row.member_notifications_enabled,
                      last_read_message_id: row.member_last_read_message_id,
                  }
                : null,
        }));

        return successResponse(channels);
    } catch (error) {
        console.error('Error getting available channels:', error);
        return errorResponse('Internal server error', 500);
    } finally {
        if (client) {
            client.release();
        }
    }
};
