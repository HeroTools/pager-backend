import { PoolClient } from 'pg';
import { Notification } from '../../types';
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

  const { rows: memberRows } = await client.query(channelMembersQuery, [
    channelId,
    senderWorkspaceMemberId,
  ]);

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

  if (mentionedWorkspaceMemberIds.length === 0) {
    return notifications;
  }

  // Lazy load channel name only when actually needed
  let channelName: string | null = null;
  let channelNameFetched = false;

  const getChannelNameCached = async (): Promise<string | null> => {
    if (!channelNameFetched && channelId) {
      channelName = await getChannelName(client, channelId);
      channelNameFetched = true;
    }
    return channelName;
  };

  for (const workspaceMemberId of mentionedWorkspaceMemberIds) {
    if (workspaceMemberId === senderWorkspaceMemberId) continue;

    const existingNotification = existingNotifications.find(
      (n) => n.workspace_member_id === workspaceMemberId,
    );

    if (existingNotification) {
      existingNotification.type = 'mention';
      if (channelId) {
        const name = await getChannelNameCached();
        existingNotification.title = `${senderName} mentioned you in #${name}`;
      } else {
        existingNotification.title = `${senderName} mentioned you in a conversation`;
      }
      existingNotification.message = truncateMessage(messageText);
    } else {
      let title: string;
      if (channelId) {
        const name = await getChannelNameCached();
        title = `${senderName} mentioned you in #${name}`;
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

  for (const member of memberRows) {
    // Don't duplicate if they're already getting a mention notification
    const alreadyNotified = existingNotifications.some(
      (n) => n.workspace_member_id === member.workspace_member_id,
    );

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

  // Cache channel name if needed
  let channelName: string | null = null;
  if (channelId) {
    channelName = await getChannelName(client, channelId);
  }

  // Notify the original message author
  const originalAuthorWorkspaceMemberId = await getOriginalMessageAuthor(
    client,
    parentMessageId,
    senderWorkspaceMemberId,
  );

  if (
    originalAuthorWorkspaceMemberId &&
    !isAlreadyNotified(existingNotifications, originalAuthorWorkspaceMemberId)
  ) {
    const title =
      channelId && channelName
        ? `${senderName} replied to your message in #${channelName}`
        : `${senderName} replied to your message`;

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

  // Notify other thread participants
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
      const title =
        channelId && channelName
          ? `New reply from ${senderName} in thread you follow in #${channelName}`
          : `New reply from ${senderName} in thread you follow`;

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
