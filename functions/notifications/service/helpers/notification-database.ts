import { PoolClient } from 'pg';
import { CreatedNotification, Notification } from '../../types';

/**
 * Insert notifications into database
 */
export async function insertNotifications(
  client: PoolClient,
  notifications: Notification[],
): Promise<CreatedNotification[]> {
  if (notifications.length === 0) return [];

  const values: string[] = [];
  const params: any[] = [];
  let paramIndex = 1;

  notifications.forEach((notification) => {
    values.push(
      `($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${
        paramIndex + 4
      }, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8})`,
    );
    params.push(
      notification.workspace_member_id,
      notification.sender_workspace_member_id,
      notification.workspace_id,
      notification.type,
      notification.title,
      notification.message,
      notification.related_message_id,
      notification.related_channel_id || null,
      notification.related_conversation_id || null,
    );
    paramIndex += 9;
  });

  const insertNotificationsQuery = `
        INSERT INTO notifications (
            workspace_member_id, sender_workspace_member_id, workspace_id, type, title, message, 
            related_message_id, related_channel_id, related_conversation_id
        ) VALUES ${values.join(', ')}
        RETURNING id, workspace_member_id, sender_workspace_member_id, workspace_id, type, title, message, created_at,
                 related_message_id, related_channel_id, related_conversation_id
    `;

  const { rows } = await client.query(insertNotificationsQuery, params);
  return rows;
}
