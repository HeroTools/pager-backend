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

        const { name, workspaceId } = JSON.parse(event.body || '{}');

        if (!name || !workspaceId) {
            return errorResponse('Name and workspaceId are required', 400);
        }

        // Check if user is an admin of the workspace
        const member = await getMember(workspaceId, userId);

        if (!member || member.role !== 'admin') {
            return errorResponse('Admin access required', 403);
        }

        const parsedName = parseChannelName(name);

        // Create channel
        const { data: channel, error } = await supabase
            .from('channels')
            .insert({
                name: parsedName,
                workspace_id: workspaceId,
            })
            .select()
            .single();

        if (error) {
            throw error;
        }

        return successResponse({ channelId: channel.id });
    } catch (error) {
        console.error('Error creating channel:', error);
        return errorResponse('Internal server error', 500);
    }
};
