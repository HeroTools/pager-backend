import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { supabase } from './utils/supabase-client';
import { errorResponse, successResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const workspaceId = event.pathParameters?.id;
        const includeDetails = event.queryStringParameters?.include_details === 'true';

        if (!workspaceId) {
            return errorResponse('Workspace ID is required', 400);
        }

        // Check if user is a workspace member and get their workspace_member record
        const { data: workspaceMember } = await supabase
            .from('workspace_members')
            .select('id, role')
            .eq('workspace_id', workspaceId)
            .eq('user_id', userId)
            .single();

        if (!workspaceMember) {
            return errorResponse('User is not a member of this workspace', 403);
        }

        // Get workspace info
        const { data: workspace } = await supabase
            .from('workspaces')
            .select('name, id, user_id')
            .eq('id', workspaceId)
            .single();

        // Basic response structure
        const response: any = {
            workspace: {
                id: workspace?.id,
                name: workspace?.name,
                user_id: workspace?.user_id,
                is_owner: workspace?.user_id === userId,
                user_role: workspaceMember.role,
            },
        };

        // Only fetch detailed info if requested
        if (includeDetails) {
            // Get only channels that the user is a member of
            const { data: userChannels } = await supabase
                .from('channel_members')
                .select(
                    `
                    channel_id,
                    role,
                    notifications_enabled,
                    last_read_message_id,
                    joined_at,
                    channels (
                        id,
                        name,
                        workspace_id,
                        channel_type,
                        created_at,
                        updated_at
                    )
                `,
                )
                .eq('workspace_member_id', workspaceMember.id);

            // Get conversations that the user is part of in this workspace
            const { data: userConversations } = await supabase
                .from('conversation_members')
                .select(
                    `
                    conversation_id,
                    joined_at,
                    left_at,
                    last_read_message_id,
                    conversations (
                        id,
                        workspace_id,
                        created_at,
                        updated_at
                    )
                `,
                )
                .eq('workspace_member_id', workspaceMember.id)
                .is('left_at', null); // Only active conversations

            // Get conversation IDs to fetch other members
            const conversationIds = userConversations?.map((conv) => conv.conversation_id) || [];

            // Get members from conversations the user is part of (excluding the user themselves)
            let conversationMembers: any[] = [];
            if (conversationIds.length > 0) {
                const { data } = await supabase
                    .from('conversation_members')
                    .select(
                        `
                        conversation_id,
                        workspace_member_id,
                        workspace_members (
                            id,
                            user_id,
                            role,
                            users (
                                id,
                                email,
                                name,
                                image
                            )
                        )
                    `,
                    )
                    .in('conversation_id', conversationIds)
                    .neq('workspace_member_id', workspaceMember.id) // Exclude current user
                    .is('left_at', null); // Only active members

                conversationMembers = data || [];
            }

            // Add detailed info to response
            response.channels =
                userChannels?.map((channelMember) => ({
                    id: channelMember.channels?.id,
                    name: channelMember.channels?.name,
                    channel_type: channelMember.channels?.channel_type,
                    created_at: channelMember.channels?.created_at,
                    updated_at: channelMember.channels?.updated_at,
                    membership: {
                        role: channelMember.role,
                        notifications_enabled: channelMember.notifications_enabled,
                        last_read_message_id: channelMember.last_read_message_id,
                        joined_at: channelMember.joined_at,
                    },
                })) || [];

            response.conversations =
                userConversations?.map((convMember) => ({
                    id: convMember.conversations?.id,
                    workspace_id: convMember.conversations?.workspace_id,
                    joined_at: convMember.joined_at,
                    last_read_message_id: convMember.last_read_message_id,
                    created_at: convMember.conversations?.created_at,
                    updated_at: convMember.conversations?.updated_at,
                    // Include other members of this conversation
                    members: conversationMembers
                        .filter((member) => member.conversation_id === convMember.conversation_id)
                        .map((member) => ({
                            id: member.workspace_members?.id,
                            user_id: member.workspace_members?.user_id,
                            role: member.workspace_members?.role,
                            user: member.workspace_members?.users,
                        })),
                })) || [];
        }

        return successResponse(response);
    } catch (error) {
        console.error('Error getting workspace info:', error);
        return errorResponse('Internal server error', 500);
    }
};
