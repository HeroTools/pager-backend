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
        const { name, channel_type } = JSON.parse(event.body || '{}');

        if (!channelId || !workspaceId) {
            return errorResponse('Channel ID and workspace ID are required', 400);
        }

        if (!name && !channel_type) {
            return errorResponse('At least one field (name or channel_type) is required', 400);
        }

        // Validate channel_type if provided
        if (channel_type && !['public', 'private'].includes(channel_type)) {
            return errorResponse('Channel type must be either "public" or "private"', 400);
        }

        const workspaceMember = await getWorkspaceMember(workspaceId, userId);

        if (!workspaceMember) {
            return errorResponse('Not a member of this workspace', 403);
        }

        const channelMember = await getChannelMember(channelId, userId);

        if (!channelMember || channelMember.role !== 'admin') {
            return errorResponse('Admin access required', 403);
        }

        // Prepare update object with only provided fields
        const updateData: any = {
            updated_at: new Date().toISOString(),
        };

        if (name) {
            const parsedName = parseChannelName(name);
            updateData.name = parsedName;
        }

        if (channel_type) {
            updateData.channel_type = channel_type;
        }

        // Update channel
        const { error } = await supabase
            .from('channels')
            .update(updateData)
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
