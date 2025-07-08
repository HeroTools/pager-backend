import { PoolClient } from 'pg';
import { z } from 'zod';

const messageAccessSchema = z.object({
  message: z.object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    workspace_member_id: z.string().uuid(),
    deleted_at: z.string().nullable(),
    parent_message_id: z.string().uuid().nullable(),
    channel_id: z.string().uuid().nullable(),
    conversation_id: z.string().uuid().nullable(),
    member_role: z.enum(['admin', 'member']),
  }),
  currentMember: z.object({
    id: z.string().uuid(),
    role: z.enum(['admin', 'member']),
  }),
  canDelete: z.boolean(),
});
type MessageAccess = z.infer<typeof messageAccessSchema>;

export const validateMessageAccess = async (
  client: PoolClient,
  messageId: string,
  userId: string,
  workspaceId: string,
): Promise<MessageAccess | null> => {
  const msgIdCheck = z.string().uuid().safeParse(messageId);
  const usrIdCheck = z.string().uuid().safeParse(userId);
  const wsIdCheck = z.string().uuid().safeParse(workspaceId);
  if (!msgIdCheck.success || !usrIdCheck.success || !wsIdCheck.success) {
    throw new Error('Invalid UUID format for messageId, userId, or workspaceId');
  }

  const { rows } = await client.query(
    `SELECT
        m.*,
        wm.id            AS workspace_member_id,
        wm.role          AS member_role,
        w.id             AS workspace_id
        FROM messages m
        JOIN workspace_members wm ON m.workspace_member_id = wm.id
        JOIN workspaces w          ON m.workspace_id        = w.id
        WHERE m.id = $1 AND m.deleted_at IS NULL AND m.workspace_id = $2`,
    [messageId, workspaceId],
  );

  if (rows.length === 0) return null;
  const messageRow = rows[0];

  const { rows: memberRows } = await client.query(
    `SELECT id, role
        FROM workspace_members
        WHERE workspace_id = $1
            AND user_id      = $2
            AND is_deactivated = false`,
    [workspaceId, userId],
  );

  if (memberRows.length === 0) return null;
  const currentMember = memberRows[0];
  const canDelete =
    currentMember.id === messageRow.workspace_member_id || currentMember.role === 'admin';

  return messageAccessSchema.parse({
    message: {
      id: messageRow.id,
      workspace_id: messageRow.workspace_id,
      workspace_member_id: messageRow.workspace_member_id,
      deleted_at: messageRow.deleted_at,
      parent_message_id: messageRow.parent_message_id,
      channel_id: messageRow.channel_id,
      conversation_id: messageRow.conversation_id,
      member_role: messageRow.member_role,
    },
    currentMember: {
      id: currentMember.id,
      role: currentMember.role,
    },
    canDelete,
  });
};
