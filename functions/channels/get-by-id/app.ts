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

        const channelId = event.pathParameters?.id;

        if (!channelId) {
            return errorResponse('Channel ID is required', 400);
        }

        // Get channel
        const { data: channel, error } = await supabase.from('channels').select('*').eq('id', channelId).single();

        if (error || !channel) {
            return errorResponse('Channel not found', 404);
        }

        // Check if user is a member of the workspace
        const member = await getMember(channel.workspace_id, userId);

        if (!member) {
            return errorResponse('Not a member of this workspace', 403);
        }

        return successResponse(channel);
    } catch (error) {
        console.error('Error getting channel by ID:', error);
        return errorResponse('Internal server error', 500);
    }
};
