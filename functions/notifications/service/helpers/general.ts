import { PoolClient } from 'pg';
import { Notification } from '../../types';

async function getChannelName(client: PoolClient, channelId: string): Promise<string> {
  const query = `SELECT name FROM channels WHERE id = $1`;
  const { rows } = await client.query(query, [channelId]);
  return rows[0]?.name || 'channel';
}

async function getOriginalMessageAuthor(
  client: PoolClient,
  parentMessageId: string,
  senderWorkspaceMemberId: string,
): Promise<string | null> {
  const query = `
        SELECT m.workspace_member_id
        FROM messages m
        JOIN workspace_members wm ON m.workspace_member_id = wm.id
        WHERE m.id = $1 AND wm.id != $2 AND wm.is_deactivated = false
    `;

  const { rows } = await client.query(query, [parentMessageId, senderWorkspaceMemberId]);
  return rows[0]?.workspace_member_id || null;
}

/**
 * Get thread participants (returns workspace_member_ids instead of user_ids)
 */
async function getThreadParticipants(
  client: PoolClient,
  threadId: string,
  senderWorkspaceMemberId: string,
): Promise<string[]> {
  const query = `
        SELECT DISTINCT m.workspace_member_id
        FROM messages m
        JOIN workspace_members wm ON m.workspace_member_id = wm.id
        WHERE (m.thread_id = $1 OR m.parent_message_id = $1 OR m.id = $1)
          AND wm.id != $2
          AND wm.is_deactivated = false
    `;

  const { rows } = await client.query(query, [threadId, senderWorkspaceMemberId]);
  return rows.map((row) => row.workspace_member_id);
}

/**
 * Check if workspace member is already notified
 */
function isAlreadyNotified(notifications: Notification[], workspaceMemberId: string): boolean {
  return notifications.some((n) => n.workspace_member_id === workspaceMemberId);
}

function truncateMessage(message: string, maxLength = 100): string {
  return message.length > maxLength ? `${message.substring(0, maxLength)}...` : message;
}

export {
  getChannelName,
  getOriginalMessageAuthor,
  getThreadParticipants,
  isAlreadyNotified,
  truncateMessage,
};
