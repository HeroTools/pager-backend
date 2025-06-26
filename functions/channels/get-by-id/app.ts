import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getWorkspaceMember } from './helpers/get-member';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';
// We will be fetching the messaging for the channel here, in addition to the information that's related to the channel.
export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const channelId = event.pathParameters?.channelId;
        const workspaceId = event.pathParameters?.workspaceId;

        if (!channelId || !workspaceId) {
            return errorResponse('Channel ID and workspace ID are required', 400);
        }

        const workspaceMember = await getWorkspaceMember(workspaceId, userId);

        if (!workspaceMember) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // only get channel if they are a channel_member and workspace_member,
        // OR workspace_member and the channel is type public
        const { data: channelMember, error: channelMemberError } = await supabase
            .from('channel_members')
            .select('id')
            .eq('channel_id', channelId)
            .eq('workspace_member_id', workspaceMember.id)
            .single();

        if (channelMemberError || !channelMember) {
            const { data: channel, error: channelError } = await supabase
                .from('channels')
                .select('id, channel_type')
                .eq('id', channelId)
                .single();

            if (channelError || !channel || channel.channel_type !== 'public') {
                return errorResponse('Not a member of this channel', 403);
            }
        }

        // Get channel
        const { data: channel, error } = await supabase.from('channels').select('*').eq('id', channelId).single();

        if (error || !channel) {
            return errorResponse('Channel not found', 404);
        }

        return successResponse(channel);
    } catch (error) {
        console.error('Error getting channel by ID:', error);
        return errorResponse('Internal server error', 500);
    }
};
