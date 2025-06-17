import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getWorkspaceMember } from './helpers/get-member';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';
import { MessageWithUser, ChannelMemberWithUser, ChannelData } from './types';

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

        // Parse query parameters for pagination
        const limit = Math.min(parseInt(event.queryStringParameters?.limit || '50'), 100);
        const cursor = event.queryStringParameters?.cursor; // Message ID to start from
        const includeBefore = event.queryStringParameters?.before; // Include messages before this timestamp

        const workspaceMember = await getWorkspaceMember(workspaceId, userId);

        if (!workspaceMember) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // Check channel access
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

        // Fetch messages with user data and attachments
        let messagesQuery = supabase
            .from('messages')
            .select(
                `
                id,
                body,
                attachment_id,
                workspace_member_id,
                workspace_id,
                channel_id,
                conversation_id,
                parent_message_id,
                thread_id,
                message_type,
                created_at,
                updated_at,
                edited_at,
                deleted_at,
                workspace_members!inner (
                    id,
                    users!inner (
                        id,
                        name,
                        email,
                        image
                    )
                ),
                attachments (
                    id,
                    url,
                    content_type,
                    size_bytes
                )
            `,
            )
            .eq('channel_id', channelId)
            .is('deleted_at', null) // Only non-deleted messages
            .order('created_at', { ascending: false });

        // Apply cursor-based pagination
        if (cursor) {
            const { data: cursorMessage } = await supabase
                .from('messages')
                .select('created_at')
                .eq('id', cursor)
                .single();

            if (cursorMessage) {
                messagesQuery = messagesQuery.lt('created_at', cursorMessage.created_at);
            }
        }

        // Apply before timestamp filter
        if (includeBefore) {
            messagesQuery = messagesQuery.lt('created_at', includeBefore);
        }

        const { data: messagesData, error: messagesError } = await messagesQuery.limit(limit + 1);

        if (messagesError) {
            console.error('Error fetching messages:', messagesError);
            return errorResponse('Failed to fetch messages', 500);
        }

        // Check if there are more messages (pagination)
        const hasMore = messagesData.length > limit;
        const messages = hasMore ? messagesData.slice(0, limit) : messagesData;
        const nextCursor = hasMore && messages.length > 0 ? messages[messages.length - 1].id : null;

        // Get total message count for the channel
        const { count: totalCount } = await supabase
            .from('messages')
            .select('id', { count: 'exact' })
            .eq('channel_id', channelId)
            .is('deleted_at', null);

        // Fetch reactions for these messages
        const messageIds = messages.map((m) => m.id);
        const { data: reactionsData } = await supabase
            .from('reactions')
            .select(
                `
                id,
                message_id,
                value,
                workspace_members!inner (
                    users!inner (
                        id,
                        name
                    )
                )
            `,
            )
            .in('message_id', messageIds);

        // Group reactions by message and emoji
        const messageReactions: Record<
            string,
            Record<string, { count: number; users: Array<{ id: string; name: string }> }>
        > = {};

        reactionsData?.forEach((reaction) => {
            const messageId = reaction.message_id;
            const emoji = reaction.value;

            if (!messageReactions[messageId]) {
                messageReactions[messageId] = {};
            }

            if (!messageReactions[messageId][emoji]) {
                messageReactions[messageId][emoji] = { count: 0, users: [] };
            }

            messageReactions[messageId][emoji].count++;
            messageReactions[messageId][emoji].users.push({
                id: reaction.workspace_members.users.id,
                name: reaction.workspace_members.users.name,
            });
        });

        // Transform messages data
        const transformedMessages: MessageWithUser[] = messages.map((message) => ({
            id: message.id,
            body: message.body,
            attachment_id: message.attachment_id,
            workspace_member_id: message.workspace_member_id,
            workspace_id: message.workspace_id,
            channel_id: message.channel_id,
            conversation_id: message.conversation_id,
            parent_message_id: message.parent_message_id,
            thread_id: message.thread_id,
            message_type: message.message_type,
            created_at: message.created_at,
            updated_at: message.updated_at,
            edited_at: message.edited_at,
            deleted_at: message.deleted_at,
            user: {
                id: message.workspace_members.users.id,
                name: message.workspace_members.users.name,
                email: message.workspace_members.users.email,
                image: message.workspace_members.users.image,
            },
            ...(message.attachments && {
                attachment: {
                    id: message.attachments.id,
                    url: message.attachments.url,
                    content_type: message.attachments.content_type,
                    size_bytes: message.attachments.size_bytes,
                },
            }),
            ...(messageReactions[message.id] && {
                reactions: Object.entries(messageReactions[message.id]).map(([emoji, data]) => ({
                    id: `${message.id}_${emoji}`,
                    value: emoji,
                    count: data.count,
                    users: data.users,
                })),
            }),
        }));

        // Fetch channel members with user data and status
        const { data: membersData, error: membersError } = await supabase
            .from('channel_members')
            .select(
                `
                id,
                channel_id,
                workspace_member_id,
                joined_at,
                role,
                notifications_enabled,
                last_read_message_id,
                workspace_members!inner (
                    id,
                    users!inner (
                        id,
                        name,
                        email,
                        image
                    )
                )
            `,
            )
            .eq('channel_id', channelId);

        if (membersError) {
            console.error('Error fetching members:', membersError);
            return errorResponse('Failed to fetch members', 500);
        }

        // Get user IDs for status lookup
        const memberUserIds = membersData.map((member) => member.workspace_members.users.id);

        // Fetch user status for all members
        const { data: statusData } = await supabase
            .from('user_status')
            .select('user_id, status, custom_status, status_emoji, last_seen_at')
            .eq('workspace_id', workspaceId)
            .in('user_id', memberUserIds);

        // Create status lookup map
        const userStatus: Record<string, any> = {};
        statusData?.forEach((status) => {
            userStatus[status.user_id] = {
                status: status.status,
                custom_status: status.custom_status,
                status_emoji: status.status_emoji,
                last_seen_at: status.last_seen_at,
            };
        });

        // Transform members data
        const transformedMembers: ChannelMemberWithUser[] = membersData.map((member) => ({
            id: member.id,
            channel_id: member.channel_id,
            workspace_member_id: member.workspace_member_id,
            joined_at: member.joined_at,
            role: member.role,
            notifications_enabled: member.notifications_enabled,
            last_read_message_id: member.last_read_message_id,
            user: {
                id: member.workspace_members.users.id,
                name: member.workspace_members.users.name,
                email: member.workspace_members.users.email,
                image: member.workspace_members.users.image,
            },
            ...(userStatus[member.workspace_members.users.id] && {
                status: userStatus[member.workspace_members.users.id],
            }),
        }));

        const responseData: ChannelData = {
            messages: transformedMessages,
            members: transformedMembers,
            pagination: {
                hasMore,
                nextCursor,
                totalCount: totalCount || 0,
            },
        };

        return successResponse(responseData);
    } catch (error) {
        console.error('Error fetching channel data:', error);
        return errorResponse('Internal server error', 500);
    }
};
