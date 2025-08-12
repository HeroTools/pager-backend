import { Handler } from 'aws-lambda';
import { PoolClient } from 'pg';

import dbPool from '../../../common/utils/create-db-pool';
import { CreatedNotification, Notification, NotificationEvent } from '../types';
import { broadcastNotification } from './helpers/broadcasting';
import {
  createChannelMessageNotifications,
  createDirectMessageNotifications,
  createMentionNotifications,
  createThreadReplyNotifications,
} from './helpers/notification-builders';
import { insertNotifications } from './helpers/notification-database';

async function processMessageNotifications(event: NotificationEvent): Promise<void> {
  let client: PoolClient | null = null;

  try {
    client = await dbPool.connect();
    await client.query('BEGIN');

    const notifications: Notification[] = [];
    const {
      messageId,
      senderWorkspaceMemberId,
      workspaceId,
      channelId,
      conversationId,
      messageText,
      parentMessageId,
      threadId,
      senderName,
      mentionedWorkspaceMemberIds,
    } = event;

    // 1. Handle channel messages (notify all members)
    if (channelId) {
      const channelNotifications = await createChannelMessageNotifications(
        client,
        channelId,
        senderWorkspaceMemberId,
        workspaceId,
        messageId,
        messageText,
        senderName,
      );
      notifications.push(...channelNotifications);
    }

    // 2. Handle mentions (upgrade existing notifications or create new ones)
    if (mentionedWorkspaceMemberIds.length > 0) {
      const mentionNotifications = await createMentionNotifications(
        client,
        mentionedWorkspaceMemberIds,
        senderWorkspaceMemberId,
        workspaceId,
        messageId,
        messageText,
        senderName,
        channelId,
        conversationId,
        notifications,
      );
      notifications.push(...mentionNotifications);
    }

    // 3. Handle direct messages
    if (conversationId) {
      const dmNotifications = await createDirectMessageNotifications(
        client,
        conversationId,
        senderWorkspaceMemberId,
        workspaceId,
        messageId,
        messageText,
        senderName,
        notifications,
      );
      notifications.push(...dmNotifications);
    }

    // 4. Handle thread replies
    if (parentMessageId) {
      const threadNotifications = await createThreadReplyNotifications(
        client,
        parentMessageId,
        threadId,
        senderWorkspaceMemberId,
        workspaceId,
        messageId,
        messageText,
        senderName,
        channelId,
        conversationId,
        notifications,
      );
      notifications.push(...threadNotifications);
    }

    // 5. Insert notifications within transaction
    let createdNotifications: CreatedNotification[] = [];
    if (notifications.length > 0) {
      createdNotifications = await insertNotifications(client, notifications);
      console.log(`Created ${notifications.length} notifications for message ${messageId}`);
    }

    await client.query('COMMIT');

    // 6. Broadcast notifications AFTER commit (outside transaction)
    if (createdNotifications.length > 0) {
      const broadcastResults = await Promise.allSettled(
        createdNotifications.map((notification) => broadcastNotification(notification)),
      );

      const failures = broadcastResults.filter((result) => result.status === 'rejected');
      if (failures.length > 0) {
        console.error(
          `Failed to broadcast ${failures.length}/${createdNotifications.length} notifications`,
        );
        failures.forEach((failure, index) => {
          if (failure.status === 'rejected') {
            console.error(`Broadcast failure ${index + 1}:`, failure.reason);
          }
        });
      }
    }
  } catch (error) {
    if (client) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }
    }
    console.error('Error processing notifications:', error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
}

export const handler: Handler = async (event: NotificationEvent) => {
  try {
    console.log('Processing notifications for message:', event.messageId);
    await processMessageNotifications(event);
    console.log('Notifications processed successfully');

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true }),
    };
  } catch (error) {
    console.error('Notification processing failed:', error);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to process notifications' }),
    };
  }
};
