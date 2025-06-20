import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getMember } from './helpers/get-member';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
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

        // Get channels that the user is a member of
        const { data: rawChannels, error } = await supabase
            .from('channels')
            .select(
                `
                *,
                channel_members!inner(
                    id,
                    role,
                    joined_at,
                    notifications_enabled,
                    last_read_message_id
                )
            `,
            )
            .eq('workspace_id', workspaceId)
            .eq('channel_members.workspace_member_id', member.id)
            .order('created_at', { ascending: true });

        if (error) {
            throw error;
        }

        const channels = (rawChannels || []).map(({ channel_members, ...channel }) => channel);

        return successResponse({ channels });
    } catch (error) {
        console.error('Error getting user channels:', error);
        return errorResponse('Internal server error', 500);
    }
};
