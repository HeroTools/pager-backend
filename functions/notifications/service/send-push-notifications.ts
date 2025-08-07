import { PoolClient } from 'pg';
import { pushNotificationService } from './push-notification-service';
import { CreatedNotification } from '../types';

/**
 * Send push notification for a created notification
 */
export async function sendPushNotificationForNotification(
  client: PoolClient,
  notification: CreatedNotification,
  workspaceId: string
): Promise<void> {
  try {
    // Get the user ID from workspace member
    const userResult = await client.query(
      `SELECT wm.user_id, u.name as user_name
       FROM workspace_members wm
       JOIN auth.users u ON u.id = wm.user_id
       WHERE wm.id = $1`,
      [notification.workspace_member_id]
    );

    if (userResult.rows.length === 0) {
      console.error(`User not found for workspace member ${notification.workspace_member_id}`);
      return;
    }

    const { user_id: userId, user_name: userName } = userResult.rows[0];

    // Get sender information if available
    let senderName = 'Someone';
    if (notification.sender_workspace_member_id) {
      const senderResult = await client.query(
        `SELECT u.name
         FROM workspace_members wm
         JOIN auth.users u ON u.id = wm.user_id
         WHERE wm.id = $1`,
        [notification.sender_workspace_member_id]
      );
      
      if (senderResult.rows.length > 0) {
        senderName = senderResult.rows[0].name;
      }
    }

    // Prepare notification data based on type
    let notificationData: any = {
      type: notification.type,
      workspaceId,
      notificationId: notification.id,
    };

    // Add relevant IDs based on notification type
    if (notification.related_channel_id) {
      notificationData.channelId = notification.related_channel_id;
    }
    if (notification.related_conversation_id) {
      notificationData.conversationId = notification.related_conversation_id;
    }
    if (notification.related_message_id) {
      notificationData.messageId = notification.related_message_id;
    }

    // Get unread count for badge
    const unreadResult = await client.query(
      `SELECT COUNT(*) as count
       FROM notifications
       WHERE workspace_member_id = $1 
       AND workspace_id = $2
       AND is_read = false`,
      [notification.workspace_member_id, workspaceId]
    );

    const unreadCount = parseInt(unreadResult.rows[0].count, 10);

    // Send push notification
    await pushNotificationService.sendToUser(client, {
      userId,
      title: notification.title,
      body: notification.message,
      data: notificationData,
      badge: unreadCount,
      sound: 'default',
    });

    console.log(`Push notification sent for ${notification.type} to ${userName}`);
  } catch (error) {
    console.error('Error sending push notification:', error);
    // Don't throw - we don't want to fail the entire notification process
  }
}

/**
 * Send push notification to multiple workspace members
 */
export async function sendPushNotificationToMembers(
  client: PoolClient,
  workspaceMemberIds: string[],
  title: string,
  body: string,
  data: Record<string, any>
): Promise<void> {
  try {
    // Get user IDs for workspace members
    const userResult = await client.query(
      `SELECT wm.id as workspace_member_id, wm.user_id
       FROM workspace_members wm
       WHERE wm.id = ANY($1)`,
      [workspaceMemberIds]
    );

    if (userResult.rows.length === 0) {
      return;
    }

    // Group by user to avoid duplicate notifications
    const userMap = new Map<string, string[]>();
    userResult.rows.forEach(row => {
      if (!userMap.has(row.user_id)) {
        userMap.set(row.user_id, []);
      }
      userMap.get(row.user_id)!.push(row.workspace_member_id);
    });

    // Send to each user
    const promises = Array.from(userMap.entries()).map(async ([userId, memberIds]) => {
      // Get unread count for the first workspace member
      const unreadResult = await client.query(
        `SELECT COUNT(*) as count
         FROM notifications
         WHERE workspace_member_id = $1 
         AND is_read = false`,
        [memberIds[0]]
      );

      const unreadCount = parseInt(unreadResult.rows[0].count, 10);

      return pushNotificationService.sendToUser(client, {
        userId,
        title,
        body,
        data,
        badge: unreadCount,
        sound: 'default',
      });
    });

    await Promise.allSettled(promises);
  } catch (error) {
    console.error('Error sending push notifications to members:', error);
  }
}

/**
 * Update badge count for a workspace member
 */
export async function updateBadgeCount(
  client: PoolClient,
  workspaceMemberId: string
): Promise<void> {
  try {
    // Get user ID
    const userResult = await client.query(
      `SELECT user_id FROM workspace_members WHERE id = $1`,
      [workspaceMemberId]
    );

    if (userResult.rows.length === 0) {
      return;
    }

    const userId = userResult.rows[0].user_id;

    // Get unread count
    const unreadResult = await client.query(
      `SELECT COUNT(*) as count
       FROM notifications
       WHERE workspace_member_id = $1 
       AND is_read = false`,
      [workspaceMemberId]
    );

    const unreadCount = parseInt(unreadResult.rows[0].count, 10);

    // Update badge
    await pushNotificationService.updateBadgeCount(client, userId, unreadCount);
  } catch (error) {
    console.error('Error updating badge count:', error);
  }
}