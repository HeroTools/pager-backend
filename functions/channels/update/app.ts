import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getChannelMember, getWorkspaceMember } from './helpers/get-member';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';
import { parseChannelName } from './helpers/parse-channel-name';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const channelId = event.pathParameters?.channelId;
        const workspaceId = event.pathParameters?.workspaceId;
        const { name } = JSON.parse(event.body || '{}');

        if (!channelId || !workspaceId) {
            return errorResponse('Channel ID and workspace ID are required', 400);
        }

        if (!name) {
            return errorResponse('Name is required', 400);
        }

        const workspaceMember = await getWorkspaceMember(workspaceId, userId);

        if (!workspaceMember) {
            return errorResponse('Not a member of this workspace', 403);
        }

        const channelMember = await getChannelMember(channelId, userId);

        if (!channelMember || channelMember.role !== 'admin') {
            return errorResponse('Admin access required', 403);
        }

        const parsedName = parseChannelName(name);

        // Update channel
        const { error } = await supabase
            .from('channels')
            .update({
                name: parsedName,
                updated_at: new Date().toISOString(),
            })
            .eq('id', channelId);

        if (error) {
            throw error;
        }

        return successResponse({ channelId });
    } catch (error) {
        console.error('Error updating channel:', error);
        return errorResponse('Internal server error', 500);
    }
};
