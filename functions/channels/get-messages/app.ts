import { APIGatewayProxyEvent, APIGatewayProxyResult, UserStatus } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';
import { EnrichedMessage } from './types';

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

        // Parse query parameters
        const limit = Math.min(parseInt(event.queryStringParameters?.limit || '50'), 100);
        const cursor = event.queryStringParameters?.cursor;
        const includeBefore = event.queryStringParameters?.before;
        const includeMembers = event.queryStringParameters?.include_members === 'true';
        const includeReactions = event.queryStringParameters?.include_reactions !== 'false'; // Default true

        // STEP 1: Get workspace member ID and verify access (SINGLE QUERY)
        // This hits idx_workspace_members_workspace_user index
        const { data: workspaceMember, error: workspaceMemberError } = await supabase
            .from('workspace_members')
            .select('id')
            .eq('workspace_id', workspaceId)
            .eq('user_id', userId)
            .eq('is_deactivated', false)
            .single();

        if (workspaceMemberError || !workspaceMember) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // STEP 2: Verify channel access and get channel info (SINGLE QUERY)
        // This hits idx_channel_members_channel_workspace index
        const { data: channelAccess, error: channelAccessError } = await supabase
            .from('channel_members')
            .select(
                `
                id,
                role,
                notifications_enabled,
                last_read_message_id,
                channels!inner(
                    id,
                    name,
                    description,
                    channel_type
                )
            `,
            )
            .eq('channel_id', channelId)
            .eq('workspace_member_id', workspaceMember.id)
            .single();

        let channelInfo: any;
        let userChannelData: any;
        if (channelAccessError || !channelAccess) {
            // Fallback: Check if it's a public channel
            const { data: publicChannel, error: publicChannelError } = await supabase
                .from('channels')
                .select('id, name, description, channel_type')
                .eq('id', channelId)
                .eq('workspace_id', workspaceId)
                .eq('channel_type', 'public')
                .single();

            if (publicChannelError || !publicChannel) {
                return errorResponse('Channel not found or access denied', 403);
            }

            // For public channels, we'll use default values
            channelInfo = publicChannel;
            userChannelData = null;
        } else {
            channelInfo = channelAccess.channels;
            userChannelData = {
                role: channelAccess.role,
                notifications_enabled: channelAccess.notifications_enabled,
                last_read_message_id: channelAccess.last_read_message_id,
            };
        }

        // STEP 3: Fetch messages (OPTIMIZED SINGLE QUERY)
        // This hits idx_messages_channel_created_at index perfectly
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
                blocks,
                metadata
            `,
            )
            .eq('channel_id', channelId)
            .is('deleted_at', null)
            .order('created_at', { ascending: false });

        // Apply cursor-based pagination
        if (cursor) {
            // Get cursor message timestamp (this could be cached in production)
            const { data: cursorMessage } = await supabase
                .from('messages')
                .select('created_at')
                .eq('id', cursor)
                .single();

            if (cursorMessage) {
                messagesQuery = messagesQuery.lt('created_at', cursorMessage.created_at);
            }
        }

        if (includeBefore) {
            messagesQuery = messagesQuery.lt('created_at', includeBefore);
        }

        const { data: messagesData, error: messagesError } = await messagesQuery.limit(limit + 1);

        if (messagesError) {
            console.error('Error fetching messages:', messagesError);
            return errorResponse('Failed to fetch messages', 500);
        }

        // Pagination logic
        const hasMore = messagesData.length > limit;
        const messages = hasMore ? messagesData.slice(0, limit) : messagesData;
        const nextCursor = hasMore && messages.length > 0 ? messages[messages.length - 1].id : null;

        // STEP 4: Batch fetch user data and reactions in parallel (OPTIMIZED)
        // Get unique workspace member IDs from messages
        const uniqueWorkspaceMemberIds = [...new Set(messages.map((m) => m.workspace_member_id))];
        const messageIds = messages.map((m) => m.id);

        // Prepare parallel queries
        const workspaceMembersQuery = supabase
            .from('workspace_members')
            .select(
                `
                id,
                user_id,
                users!workspace_members_user_id_fkey1(
                    id,
                    name,
                    image
                )
            `,
            )
            .in('id', uniqueWorkspaceMemberIds)
            .eq('is_deactivated', false);

        const reactionsQuery =
            includeReactions && messages.length > 0
                ? supabase
                      .from('reactions')
                      .select(
                          `
                    id,
                    message_id,
                    value,
                    workspace_members!inner(
                        users!workspace_members_user_id_fkey1(id, name)
                    )
                `,
                      )
                      .in('message_id', messageIds)
                : Promise.resolve({ data: null, error: null });

        // Execute queries in parallel
        const [
            { data: workspaceMembers, error: workspaceMembersError },
            { data: reactionsData, error: reactionsError },
        ] = await Promise.all([workspaceMembersQuery, reactionsQuery]);

        if (workspaceMembersError) {
            console.error('Error fetching workspace members:', workspaceMembersError);
            return errorResponse('Failed to fetch user data', 500);
        }

        if (reactionsError) {
            console.error('Error fetching reactions:', reactionsError);
            return errorResponse('Failed to fetch reactions', 500);
        }

        // Create lookup maps for O(1) access
        const workspaceMemberMap: Record<string, any> = {};
        const userIds: string[] = [];

        workspaceMembers?.forEach((wm) => {
            workspaceMemberMap[wm.id] = {
                id: wm.users.id,
                name: wm.users.name,
                image: wm.users.image,
            };
            userIds.push(wm.users.id);
        });

        // Process reactions data
        const reactionsMap: Record<string, any[]> = {};

        if (reactionsData) {
            reactionsData.forEach((reaction) => {
                const messageId = reaction.message_id;
                const emoji = reaction.value;

                if (!reactionsMap[messageId]) {
                    reactionsMap[messageId] = {};
                }

                if (!reactionsMap[messageId][emoji]) {
                    reactionsMap[messageId][emoji] = {
                        id: `${messageId}_${emoji}`,
                        value: emoji,
                        count: 0,
                        users: [],
                    };
                }

                reactionsMap[messageId][emoji].count++;
                reactionsMap[messageId][emoji].users.push({
                    id: reaction.workspace_members.users.id,
                    name: reaction.workspace_members.users.name,
                });
            });
        }

        // STEP 5: Fetch user status and attachments in parallel (OPTIMIZED)
        const messagesWithAttachments = messages.filter((m) => m.attachment_id);

        const userStatusQuery =
            userIds.length > 0
                ? supabase
                      .from('user_status')
                      .select('user_id, status, custom_status, status_emoji, last_seen_at')
                      .eq('workspace_id', workspaceId)
                      .in('user_id', userIds)
                : Promise.resolve({ data: null, error: null });

        const attachmentsQuery =
            messagesWithAttachments.length > 0
                ? supabase
                      .from('attachments')
                      .select('id, url, content_type, size_bytes')
                      .in(
                          'id',
                          messagesWithAttachments.map((m) => m.attachment_id),
                      )
                : Promise.resolve({ data: null, error: null });

        // Execute remaining queries in parallel
        const [{ data: userStatusData }, { data: attachments }] = await Promise.all([
            userStatusQuery,
            attachmentsQuery,
        ]);

        // Process user status data
        const userStatusMap: Record<string, UserStatus> = {};
        userStatusData?.forEach((status) => {
            userStatusMap[status.user_id] = status;
        });

        // Process attachments data
        const attachmentMap: Record<string, any> = {};
        attachments?.forEach((att) => {
            attachmentMap[att.id] = att;
        });

        // STEP 6: Assemble enriched messages (IN-MEMORY OPERATION)
        const enrichedMessages: EnrichedMessage[] = messages.map((message) => {
            const user = workspaceMemberMap[message.workspace_member_id] || {
                id: 'unknown',
                name: 'Unknown User',
                image: null,
            };

            const enrichedMessage: EnrichedMessage = {
                ...message,
                user,
                ...(message.attachment_id &&
                    attachmentMap[message.attachment_id] && {
                        attachment: attachmentMap[message.attachment_id],
                    }),
                ...(reactionsMap[message.id] && {
                    reactions: Object.values(reactionsMap[message.id]),
                }),
            };

            return enrichedMessage;
        });

        // STEP 7: Fetch channel members if requested (OPTIONAL SINGLE QUERY)
        let channelMembers: any[] = [];

        if (includeMembers) {
            const { data: membersData } = await supabase
                .from('channel_members')
                .select(
                    `
                    id,
                    workspace_member_id,
                    role,
                    joined_at,
                    notifications_enabled,
                    last_read_message_id
                `,
                )
                .eq('channel_id', channelId);

            // Enrich members with user data from our existing workspace member map
            channelMembers =
                membersData?.map((member) => ({
                    ...member,
                    user: workspaceMemberMap[member.workspace_member_id] || {
                        id: 'unknown',
                        name: 'Unknown User',
                        image: null,
                    },
                })) || [];
        }

        // STEP 8: Get message count (OPTIONAL - can be cached)
        let totalCount = 0;
        const includeCount = event.queryStringParameters?.include_count === 'true';

        if (includeCount) {
            const { count } = await supabase
                .from('messages')
                .select('id', { count: 'exact' })
                .eq('channel_id', channelId)
                .is('deleted_at', null);
            totalCount = count || 0;
        }

        // FINAL RESPONSE
        const responseData = {
            channel: channelInfo,
            messages: enrichedMessages,
            members: channelMembers,
            pagination: {
                hasMore,
                nextCursor,
                totalCount,
            },
            user_channel_data: userChannelData,
        };

        return successResponse(responseData);
    } catch (error) {
        console.error('Error fetching channel data:', error);
        return errorResponse('Internal server error', 500);
    }
};
