import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getWorkspaceMember } from './helpers/get-member';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';
import { ConversationData, MessageWithUser, ConversationMemberWithUser } from './types';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const conversationId = event.pathParameters?.id;
        const workspaceId = event.pathParameters?.workspaceId;

        if (!conversationId || !workspaceId) {
            return errorResponse('Conversation ID and workspace ID are required', 400);
        }

        // Parse query parameters for pagination
        const limit = Math.min(parseInt(event.queryStringParameters?.limit || '50'), 100);
        const cursor = event.queryStringParameters?.cursor; // Message ID to start from
        const includeBefore = event.queryStringParameters?.before; // Include messages before this timestamp
        const includeMembers = event.queryStringParameters?.include_members !== 'false'; // Default true
        const includeReactions = event.queryStringParameters?.include_reactions !== 'false'; // Default true
        const includeCount = event.queryStringParameters?.include_count === 'true';

        const workspaceMember = await getWorkspaceMember(workspaceId, userId);

        if (!workspaceMember) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // STEP 1: Check conversation access and get conversation info (PARALLEL)
        const [
            { data: conversationMember, error: conversationMemberError },
            { data: conversationInfo, error: conversationError },
        ] = await Promise.all([
            supabase
                .from('conversation_members')
                .select('id')
                .eq('conversation_id', conversationId)
                .eq('workspace_member_id', workspaceMember.id)
                .is('left_at', null) // Only active members
                .single(),
            supabase
                .from('conversations')
                .select('id, workspace_id, created_at, updated_at')
                .eq('id', conversationId)
                .single(),
        ]);

        if (conversationMemberError || !conversationMember) {
            return errorResponse('Not a member of this conversation', 403);
        }

        if (conversationError || !conversationInfo) {
            return errorResponse('Conversation not found', 404);
        }

        // STEP 2: Fetch messages (OPTIMIZED SINGLE QUERY)
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
                deleted_at
            `,
            )
            .eq('conversation_id', conversationId)
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

        // Pagination logic
        const hasMore = messagesData.length > limit;
        const messages = hasMore ? messagesData.slice(0, limit) : messagesData;
        const nextCursor = hasMore && messages.length > 0 ? messages[messages.length - 1].id : null;

        // STEP 3: Batch fetch user data and reactions in parallel (OPTIMIZED)
        const uniqueWorkspaceMemberIds = [...new Set(messages.map((m) => m.workspace_member_id))];
        const messageIds = messages.map((m) => m.id);

        // Prepare parallel queries
        const workspaceMembersQuery =
            uniqueWorkspaceMemberIds.length > 0
                ? supabase
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
                      .eq('is_deactivated', false)
                : Promise.resolve({ data: null, error: null });

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
        const messageReactions: Record<
            string,
            Record<string, { count: number; users: Array<{ id: string; name: string }> }>
        > = {};

        if (reactionsData) {
            reactionsData.forEach((reaction) => {
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
        }

        // STEP 4: Fetch attachments, conversation members, and optional data in parallel (OPTIMIZED)
        const messagesWithAttachments = messages.filter((m) => m.attachment_id);

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

        const conversationMembersQuery = includeMembers
            ? supabase
                  .from('conversation_members')
                  .select(
                      `
                    id,
                    conversation_id,
                    workspace_member_id,
                    joined_at,
                    left_at,
                    last_read_message_id,
                    workspace_members!inner(
                        id,
                        users!workspace_members_user_id_fkey1(
                            id,
                            name,
                            image
                        )
                    )
                `,
                  )
                  .eq('conversation_id', conversationId)
                  .is('left_at', null) // Only active members
            : Promise.resolve({ data: null, error: null });

        const messageCountQuery = includeCount
            ? supabase
                  .from('messages')
                  .select('id', { count: 'exact' })
                  .eq('conversation_id', conversationId)
                  .is('deleted_at', null)
            : Promise.resolve({ count: 0, error: null });

        // Execute queries in parallel
        const [{ data: attachments }, { data: membersData, error: membersError }, { count: totalCount }] =
            await Promise.all([attachmentsQuery, conversationMembersQuery, messageCountQuery]);

        if (membersError && includeMembers) {
            console.error('Error fetching members:', membersError);
            return errorResponse('Failed to fetch members', 500);
        }

        // Process attachments data
        const attachmentMap: Record<string, any> = {};
        attachments?.forEach((att) => {
            attachmentMap[att.id] = att;
        });

        // STEP 5: Fetch user status for conversation members (if members are included)
        const userStatus: Record<string, any> = {};

        if (includeMembers && membersData && membersData.length > 0) {
            const memberUserIds = membersData.map((member) => member.workspace_members.users.id);

            const { data: statusData } = await supabase
                .from('user_status')
                .select('user_id, status, custom_status, status_emoji, last_seen_at')
                .eq('workspace_id', workspaceId)
                .in('user_id', memberUserIds);

            statusData?.forEach((status) => {
                userStatus[status.user_id] = {
                    status: status.status,
                    custom_status: status.custom_status,
                    status_emoji: status.status_emoji,
                    last_seen_at: status.last_seen_at,
                };
            });
        }

        // STEP 6: Assemble enriched messages (IN-MEMORY OPERATION)
        const transformedMessages: MessageWithUser[] = messages.map((message) => {
            const user = workspaceMemberMap[message.workspace_member_id] || {
                id: 'unknown',
                name: 'Unknown User',
                image: null,
            };

            return {
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
                user,
                ...(message.attachment_id &&
                    attachmentMap[message.attachment_id] && {
                        attachment: attachmentMap[message.attachment_id],
                    }),
                ...(messageReactions[message.id] && {
                    reactions: Object.entries(messageReactions[message.id]).map(([emoji, data]) => ({
                        id: `${message.id}_${emoji}`,
                        value: emoji,
                        count: data.count,
                        users: data.users,
                    })),
                }),
            };
        });

        // STEP 7: Transform members data (if included)
        let transformedMembers: ConversationMemberWithUser[] = [];

        if (includeMembers && membersData) {
            transformedMembers = membersData.map((member) => ({
                id: member.id,
                conversation_id: member.conversation_id,
                workspace_member_id: member.workspace_member_id,
                joined_at: member.joined_at,
                left_at: member.left_at,
                last_read_message_id: member.last_read_message_id,
                user: {
                    id: member.workspace_members.users.id,
                    name: member.workspace_members.users.name,
                    image: member.workspace_members.users.image,
                },
                ...(userStatus[member.workspace_members.users.id] && {
                    status: userStatus[member.workspace_members.users.id],
                }),
            }));
        }

        // FINAL RESPONSE
        const responseData: ConversationData = {
            conversation: conversationInfo,
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
        console.error('Error fetching conversation data:', error);
        return errorResponse('Internal server error', 500);
    }
};
