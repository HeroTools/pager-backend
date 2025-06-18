import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getChannelMembers, getConversationMembers, getWorkspaceMember } from './helpers/get-members';
import { supabase } from './utils/supabase-client';
import { errorResponse, successResponse } from './utils/response';
import { broadcastTypingStatus, broadcastMessage } from './helpers/broadcasting';

interface SendMessageRequest {
    body: string;
    attachment_id?: string;
    parent_message_id?: string;
    thread_id?: string;
    message_type?: 'direct' | 'thread' | 'system' | 'bot';
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const workspaceId = event.pathParameters?.workspaceId;
        const channelId = event.pathParameters?.channelId;
        const conversationId = event.pathParameters?.conversationId;

        if (!workspaceId) {
            return errorResponse('Workspace ID is required', 400);
        }

        if (!channelId && !conversationId) {
            return errorResponse('Either channel ID or conversation ID is required', 400);
        }

        const requestBody: SendMessageRequest = JSON.parse(event.body || '{}');
        const { body, attachment_id, parent_message_id, thread_id, message_type = 'direct' } = requestBody;

        if (!body?.trim()) {
            return errorResponse('Message body is required', 400);
        }

        const workspaceMember = await getWorkspaceMember(workspaceId, userId);

        if (!workspaceMember) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // Validate channel access if sending to channel
        if (channelId) {
            const { data: channelMember, error: channelMemberError } = await supabase
                .from('channel_members')
                .select('id')
                .eq('channel_id', channelId)
                .eq('workspace_member_id', workspaceMember.id)
                .single();

            if (channelMemberError || !channelMember) {
                // Check if it's a public channel
                const { data: channel, error: channelError } = await supabase
                    .from('channels')
                    .select('id, channel_type')
                    .eq('id', channelId)
                    .single();

                if (channelError || !channel || channel.channel_type !== 'public') {
                    return errorResponse('Not a member of this channel', 403);
                }
            }
        }

        // Validate conversation access if sending to conversation
        if (conversationId) {
            const { data: conversationMember, error: conversationMemberError } = await supabase
                .from('conversation_members')
                .select('id')
                .eq('conversation_id', conversationId)
                .eq('workspace_member_id', workspaceMember.id)
                .is('left_at', null) // Only active members
                .single();

            if (conversationMemberError || !conversationMember) {
                return errorResponse('Not a member of this conversation', 403);
            }
        }

        // Handle thread logic
        let finalThreadId = thread_id;
        const finalParentId = parent_message_id;

        if (parent_message_id) {
            const { data: parentMessage, error: parentError } = await supabase
                .from('messages')
                .select('id, thread_id, channel_id, conversation_id')
                .eq('id', parent_message_id)
                .single();

            if (parentError || !parentMessage) {
                return errorResponse('Parent message not found', 404);
            }

            // Ensure parent message belongs to same channel/conversation
            if (channelId && parentMessage.channel_id !== channelId) {
                return errorResponse('Parent message is not in this channel', 400);
            }
            if (conversationId && parentMessage.conversation_id !== conversationId) {
                return errorResponse('Parent message is not in this conversation', 400);
            }

            // If parent has a thread_id, use it; otherwise parent becomes the thread
            finalThreadId = parentMessage.thread_id || parent_message_id;
        }

        // Validate attachment if provided
        if (attachment_id) {
            const { data: attachment, error: attachmentError } = await supabase
                .from('attachments')
                .select('id, uploaded_by')
                .eq('id', attachment_id)
                .eq('uploaded_by', userId)
                .single();

            if (attachmentError || !attachment) {
                return errorResponse('Invalid attachment', 400);
            }
        }

        // Stop typing notification before sending message
        await broadcastTypingStatus(userId, channelId, conversationId, false);

        // Insert the message
        const { data: message, error: insertError } = await supabase
            .from('messages')
            .insert({
                body: body.trim(),
                attachment_id: attachment_id || null,
                workspace_member_id: workspaceMember.id,
                workspace_id: workspaceId,
                channel_id: channelId || null,
                conversation_id: conversationId || null,
                parent_message_id: finalParentId || null,
                thread_id: finalThreadId || null,
                message_type,
                created_at: new Date().toISOString(),
            })
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
                workspace_members!messages_workspace_member_id_fkey (
                    id,
                    users!workspace_members_user_id_fkey1 (
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
            .single();

        if (insertError) {
            console.error('Error inserting message:', insertError);
            return errorResponse('Failed to send message', 500);
        }

        // Transform the response to match your frontend expectations
        const transformedMessage = {
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
            edited_at: null,
            deleted_at: null,
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
            reactions: [],
        };

        // Send message to all connected clients
        await broadcastMessage(transformedMessage, channelId, conversationId);

        // Optional: Send push notifications to offline users
        // You could add this later for mobile apps
        const memberIds = channelId
            ? await getChannelMembers(channelId)
            : await getConversationMembers(conversationId!);

        // Log for debugging
        console.log(`Message sent to ${memberIds.length} members in ${channelId ? 'channel' : 'conversation'}`);

        return successResponse(transformedMessage);
    } catch (error) {
        console.error('Error creating message:', error);
        return errorResponse('Internal server error', 500);
    }
};
