import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { supabase } from '../../common/utils/supabase-client';
import { setCorsHeaders, successResponse, errorResponse } from '../../common/utils/response';

interface ChannelMember {
    id: string;
    role: string;
    workspace_member_id: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers.Origin || event.headers.origin;
    const corsHeaders = setCorsHeaders(origin, 'GET,POST,OPTIONS');

    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 204,
            headers: corsHeaders,
            body: '',
        };
    }

    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);
        if (!userId) {
            return errorResponse('Unauthorized', 401, corsHeaders);
        }

        const channelId = event.pathParameters?.channelId;
        const workspaceId = event.pathParameters?.workspaceId;
        if (!channelId || !workspaceId) {
            return errorResponse('Channel ID and workspace ID are required', 400, corsHeaders);
        }

        const workspaceMember = await getMember(workspaceId, userId);
        if (!workspaceMember) {
            return errorResponse('Not a member of this workspace', 403, corsHeaders);
        }

        const { data: channel, error: channelError } = await supabase
            .from('channels')
            .select('id')
            .eq('id', channelId)
            .single();
        if (channelError || !channel) {
            return errorResponse('Channel not found', 404, corsHeaders);
        }

        const { data: channelMembers, error: membersError } = await supabase
            .from('channel_members')
            .select(
                `
                id,
                role,
                workspace_member_id
            `,
            )
            .eq('channel_id', channelId);
        if (membersError) {
            console.error('Supabase error fetching channel members:', membersError);
            return errorResponse('Failed to fetch channel members', 500, corsHeaders, {
                details: membersError.message || membersError,
            });
        }

        const members = (channelMembers || []).map((cm: ChannelMember) => ({
            channel_member_id: cm.id,
            channel_role: cm.role,
            workspace_member_id: cm.workspace_member_id,
        }));
        return successResponse(members, 200, corsHeaders);
    } catch (error) {
        console.error('Error getting channel members:', error);
        return errorResponse('Internal server error', 500, corsHeaders);
    }
};
