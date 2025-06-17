import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getChannelMember } from './helpers/get-member';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const channelId = event.pathParameters?.id;
        const workspaceId = event.pathParameters?.workspaceId;

        if (!channelId || !workspaceId) {
            return errorResponse('Channel ID and workspace ID are required', 400);
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

        // Check if user is an admin of the channel
        const channelMember = await getChannelMember(channelId, userId);

        if (!channelMember || channelMember.role !== 'admin') {
            return errorResponse('Admin access required', 403);
        }

        // Delete all messages in the channel first
        const { error: messagesError } = await supabase.from('messages').delete().eq('channel_id', channelId);

        if (messagesError) {
            console.error('Error deleting channel messages:', messagesError);
            // Continue with channel deletion even if message deletion fails
        }

        // Delete channel
        const { error } = await supabase.from('channels').delete().eq('id', channelId);

        if (error) {
            throw error;
        }

        return successResponse({ channelId });
    } catch (error) {
        console.error('Error deleting channel:', error);
        return errorResponse('Internal server error', 500);
    }
};
