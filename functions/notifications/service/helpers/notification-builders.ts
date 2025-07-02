import { PoolClient } from 'pg';
import { Notification } from '../types';
import {
    getChannelName,
    getOriginalMessageAuthor,
    getThreadParticipants,
    isAlreadyNotified,
    truncateMessage,
} from './general';

/**
 * Create channel message notifications (notify all channel members)
 */
export async function createChannelMessageNotifications(
    client: PoolClient,
    channelId: string,
    senderWorkspaceMemberId: string,
    workspaceId: string,
    messageId: string,
    messageText: string,
    senderName: string,
): Promise<Notification[]> {
    const notifications: Notification[] = [];

    const channelMembersQuery = `
        SELECT wm.id as workspace_member_id
        FROM channel_members cm
        JOIN workspace_members wm ON cm.workspace_member_id = wm.id
        WHERE cm.channel_id = $1 
          AND cm.left_at IS NULL 
          AND wm.id != $2
          AND wm.is_deactivated = false
    `;

    const { rows: memberRows } = await client.query(channelMembersQuery, [channelId, senderWorkspaceMemberId]);
    const channelName = await getChannelName(client, channelId);

    for (const member of memberRows) {
        notifications.push({
            workspace_member_id: member.workspace_member_id,
            sender_workspace_member_id: senderWorkspaceMemberId,
            workspace_id: workspaceId,
            type: 'channel_message',
            title: `New message in #${channelName}`,
            message: `${senderName}: ${truncateMessage(messageText)}`,
            related_message_id: messageId,
            related_channel_id: channelId,
        });
    }

    return notifications;
}

/**
 * Create mention notifications
 */
export async function createMentionNotifications(
    client: PoolClient,
    mentionedWorkspaceMemberIds: string[],
    senderWorkspaceMemberId: string,
    workspaceId: string,
    messageId: string,
    messageText: string,
    senderName: string,
    channelId?: string,
    conversationId?: string,
    existingNotifications: Notification[] = [],
): Promise<Notification[]> {
    const notifications: Notification[] = [];

    for (const workspaceMemberId of mentionedWorkspaceMemberIds) {
        if (workspaceMemberId === senderWorkspaceMemberId) continue; // Don't notify the sender

        // Check if user already has a notification (from channel message)
        const existingNotification = existingNotifications.find((n) => n.workspace_member_id === workspaceMemberId);

        if (existingNotification) {
            // Upgrade existing channel notification to mention notification
            existingNotification.type = 'mention';
            if (channelId) {
                const channelName = await getChannelName(client, channelId);
                existingNotification.title = `${senderName} mentioned you in #${channelName}`;
                existingNotification.message = truncateMessage(messageText);
            } else {
                existingNotification.title = `${senderName} mentioned you in a conversation`;
                existingNotification.message = truncateMessage(messageText);
            }
        } else {
            // Create new mention notification
            let title: string;

            if (channelId) {
                const channelName = await getChannelName(client, channelId);
                title = `${senderName} mentioned you in #${channelName}`;
            } else {
                title = `${senderName} mentioned you in a conversation`;
            }

            notifications.push({
                workspace_member_id: workspaceMemberId,
                sender_workspace_member_id: senderWorkspaceMemberId,
                workspace_id: workspaceId,
                type: 'mention',
                title,
                message: truncateMessage(messageText),
                related_message_id: messageId,
                related_channel_id: channelId || undefined,
                related_conversation_id: conversationId || undefined,
            });
        }
    }

    return notifications;
}

/**
 * Create direct message notifications
 */
export async function createDirectMessageNotifications(
    client: PoolClient,
    conversationId: string,
    senderWorkspaceMemberId: string,
    workspaceId: string,
    messageId: string,
    messageText: string,
    senderName: string,
    existingNotifications: Notification[],
): Promise<Notification[]> {
    const notifications: Notification[] = [];

    const conversationMembersQuery = `
        SELECT wm.id as workspace_member_id
        FROM conversation_members cm
        JOIN workspace_members wm ON cm.workspace_member_id = wm.id
        WHERE cm.conversation_id = $1 
          AND cm.left_at IS NULL 
          AND wm.id != $2
          AND wm.is_deactivated = false
    `;

    const { rows: memberRows } = await client.query(conversationMembersQuery, [
        conversationId,
        senderWorkspaceMemberId,
    ]);

    console.log('memberRows:', memberRows);

    for (const member of memberRows) {
        // Don't duplicate if they're already getting a mention notification
        const alreadyNotified = existingNotifications.some((n) => n.workspace_member_id === member.workspace_member_id);

        if (!alreadyNotified) {
            notifications.push({
                workspace_member_id: member.workspace_member_id,
                sender_workspace_member_id: senderWorkspaceMemberId,
                workspace_id: workspaceId,
                type: 'direct_message',
                title: `New message from ${senderName}`,
                message: truncateMessage(messageText),
                related_message_id: messageId,
                related_conversation_id: conversationId,
            });
        }
    }

    return notifications;
}

/**
 * Create thread reply notifications
 */
export async function createThreadReplyNotifications(
    client: PoolClient,
    parentMessageId: string,
    threadId: string | undefined,
    senderWorkspaceMemberId: string,
    workspaceId: string,
    messageId: string,
    messageText: string,
    senderName: string,
    channelId?: string,
    conversationId?: string,
    existingNotifications: Notification[] = [],
): Promise<Notification[]> {
    const notifications: Notification[] = [];
    const actualThreadId = threadId || parentMessageId;

    // Notify the original message author (need to update this helper to return workspace_member_id)
    const originalAuthorWorkspaceMemberId = await getOriginalMessageAuthor(
        client,
        parentMessageId,
        senderWorkspaceMemberId,
    );
    if (originalAuthorWorkspaceMemberId && !isAlreadyNotified(existingNotifications, originalAuthorWorkspaceMemberId)) {
        let title: string;

        if (channelId) {
            const channelName = await getChannelName(client, channelId);
            title = `${senderName} replied to your message in #${channelName}`;
        } else {
            title = `${senderName} replied to your message`;
        }

        notifications.push({
            workspace_member_id: originalAuthorWorkspaceMemberId,
            sender_workspace_member_id: senderWorkspaceMemberId,
            workspace_id: workspaceId,
            type: 'thread_reply',
            title,
            message: truncateMessage(messageText),
            related_message_id: messageId,
            related_channel_id: channelId || undefined,
            related_conversation_id: conversationId || undefined,
        });
    }

    // Notify other thread participants (need to update this helper to return workspace_member_ids)
    const threadParticipantWorkspaceMemberIds = await getThreadParticipants(
        client,
        actualThreadId,
        senderWorkspaceMemberId,
    );

    for (const participantWorkspaceMemberId of threadParticipantWorkspaceMemberIds) {
        const alreadyNotified = isAlreadyNotified(
            [...existingNotifications, ...notifications],
            participantWorkspaceMemberId,
        );

        if (!alreadyNotified) {
            let title: string;

            if (channelId) {
                const channelName = await getChannelName(client, channelId);
                title = `New reply from ${senderName} in thread you follow in #${channelName}`;
            } else {
                title = `New reply from ${senderName} in thread you follow`;
            }

            notifications.push({
                workspace_member_id: participantWorkspaceMemberId,
                sender_workspace_member_id: senderWorkspaceMemberId,
                workspace_id: workspaceId,
                type: 'thread_reply',
                title,
                message: truncateMessage(messageText),
                related_message_id: messageId,
                related_channel_id: channelId || undefined,
                related_conversation_id: conversationId || undefined,
            });
        }
    }

    return notifications;
}
