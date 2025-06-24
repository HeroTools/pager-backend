import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getWorkspaceMember } from './helpers/get-member';
import { supabase } from './utils/supabase-client';
import { setCorsHeaders, successResponse, errorResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers.Origin || event.headers.origin;
    const corsHeaders = setCorsHeaders(origin, 'GET,POST,OPTIONS');

    // 1) Handle preflight
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

        const workspaceMember = await getWorkspaceMember(workspaceId, userId);
        if (!workspaceMember) {
            return errorResponse('Not a member of this workspace', 403, corsHeaders);
        }

        // Check if channel exists
        const { data: channel, error: channelError } = await supabase
            .from('channels')
            .select('id')
            .eq('id', channelId)
            .single();
        if (channelError || !channel) {
            return errorResponse('Channel not found', 404, corsHeaders);
        }

        // Get all members of the channel, including user info
        const { data: channelMembers, error: membersError } = await supabase
            .from('channel_members')
            .select(`
                id,
                role,
                workspace_member:workspace_member_id (
                    id,
                    user_id,
                    role,
                    user:user_id (
                        id,
                        email,
                        name,
                        image
                    )
                )
            `)
            .eq('channel_id', channelId);
        if (membersError) {
            console.error('Supabase error fetching channel members:', membersError);
            return errorResponse('Failed to fetch channel members', 500, corsHeaders, { details: membersError.message || membersError });
        }

        // Flatten the member info to return user info for each channel member
        const members = (channelMembers || []).map((cm: any) => {
            return {
                channel_member_id: cm.id,
                channel_role: cm.role,
                workspace_member_id: cm.workspace_member?.id,
                workspace_role: cm.workspace_member?.role,
                user: cm.workspace_member?.user || null
            };
        });
        return successResponse(members, 200, corsHeaders);
    } catch (error) {
        console.error('Error getting channel members:', error);
        return errorResponse('Internal server error', 500, corsHeaders);
    }
};
