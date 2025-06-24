import { APIGatewayProxyHandler } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getWorkspaceMember } from './helpers/get-member';
import { successResponse, errorResponse } from './utils/response';
import { parseChannelName } from './helpers/parse-channel-name';
import dbPool from './utils/create-db-pool';

export const handler: APIGatewayProxyHandler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    let client;
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const { name, channelType = 'public', description } = JSON.parse(event.body || '{}');

        const workspaceId = event.pathParameters?.workspaceId;

        if (!name || !workspaceId) {
            return errorResponse('Name and workspaceId are required', 400);
        }

        client = await dbPool.connect();

        const member = await getWorkspaceMember(client, workspaceId, userId);

        if (!member) {
            return errorResponse('User is not a member of this workspace', 403);
        }

        const parsedName = parseChannelName(name);

        const result = await client.query(
            `
            WITH new_channel AS (
                INSERT INTO channels (name, workspace_id, channel_type, description)
                SELECT $1, $2, $3, $4
                WHERE NOT EXISTS (
                    SELECT 1 FROM channels 
                    WHERE workspace_id = $2 AND name = $1
                )
                RETURNING id, name, channel_type, created_at
            ),
            new_member AS (
                INSERT INTO channel_members (channel_id, workspace_member_id, role)
                SELECT id, $5, 'admin' 
                FROM new_channel
                RETURNING channel_id
            )
            SELECT 
                nc.id as channel_id,
                nc.name,
                nc.channel_type,
                nc.created_at,
                CASE WHEN nc.id IS NOT NULL THEN true ELSE false END as created,
                nm.channel_id IS NOT NULL as member_added
            FROM new_channel nc
            LEFT JOIN new_member nm ON nc.id = nm.channel_id
        `,
            [parsedName, workspaceId, channelType, description || null, member.id],
        );

        // Check if channel was created
        if (result.rows.length === 0 || !result.rows[0].created) {
            return errorResponse(`Channel with name "${parsedName}" already exists in this workspace`, 409);
        }

        const channelData = result.rows[0];

        return successResponse({
            id: channelData.channel_id,
            name: channelData.name,
            channel_type: channelData.channel_type,
            created_at: channelData.created_at,
        });
    } catch (error) {
        console.error('Error creating channel:', error);

        if ('code' in (error as any) && (error as any).code === '23505') {
            return errorResponse('Channel name already exists', 409);
        }

        return errorResponse('Internal server error', 500);
    } finally {
        if (client) {
            client.release();
        }
    }
};
