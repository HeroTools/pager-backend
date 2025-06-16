import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getMember } from './helpers/get-member';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';
import { parseChannelName } from './helpers/parse-channel-name';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const channelId = event.pathParameters?.id;
        const { name } = JSON.parse(event.body || '{}');

        if (!channelId) {
            return errorResponse('Channel ID is required', 400);
        }

        if (!name) {
            return errorResponse('Name is required', 400);
        }

        // Get channel
        const { data: channel, error: channelError } = await supabase
            .from('channels')
            .select('*')
            .eq('id', channelId)
            .single();

        if (channelError || !channel) {
            return errorResponse('Channel not found', 404);
        }

        // Check if user is an admin of the workspace
        const member = await getMember(channel.workspace_id, userId);

        if (!member || member.role !== 'admin') {
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
