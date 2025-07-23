import { PoolClient } from 'pg';
import { AgentMessageWithSender } from '../../types';

export interface AiConversation {
  id: string;
  workspace_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  ai_agent_id?: string;
}

export async function getOrCreateConversation(
  client: PoolClient,
  workspaceId: string,
  workspaceMemberId: string,
  agentId: string,
  conversationId?: string,
): Promise<AiConversation> {
  if (conversationId) {
    const result = await client.query(
      `SELECT c.* FROM conversations c
       INNER JOIN conversation_members cm ON c.id = cm.conversation_id
       WHERE c.id = $1
         AND c.workspace_id = $2
         AND cm.workspace_member_id = $3
         AND EXISTS (
           SELECT 1 FROM conversation_members cm2
           WHERE cm2.conversation_id = c.id
             AND cm2.ai_agent_id = $4
         )`,
      [conversationId, workspaceId, workspaceMemberId, agentId],
    );

    if (result.rows[0]) {
      return result.rows[0];
    }
  }

  await client.query('BEGIN');

  try {
    // Create new conversation
    const conversationResult = await client.query(
      `INSERT INTO conversations (workspace_id, title)
       VALUES ($1, $2)
       RETURNING *`,
      [workspaceId, 'AI Conversation'],
    );

    const conversation = conversationResult.rows[0];

    // Add user as conversation member
    await client.query(
      `INSERT INTO conversation_members (conversation_id, workspace_member_id, joined_at)
       VALUES ($1, $2, NOW())`,
      [conversation.id, workspaceMemberId],
    );

    // Add agent as conversation member
    await client.query(
      `INSERT INTO conversation_members (conversation_id, ai_agent_id, joined_at)
       VALUES ($1, $2, NOW())`,
      [conversation.id, agentId],
    );

    await client.query('COMMIT');
    return conversation;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

export async function saveAiMessage(
  client: PoolClient,
  conversationId: string,
  workspaceId: string,
  senderType: 'user' | 'agent' | 'system',
  content: string,
  workspaceMemberId?: string,
  agentId?: string,
): Promise<AgentMessageWithSender> {
  const messageResult = await client.query(
    `INSERT INTO messages (
        conversation_id,
        workspace_id,
        body,
        text,
        sender_type,
        workspace_member_id,
        ai_agent_id,
        message_type,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'direct', NOW(), NOW())
      RETURNING
        id,
        body,
        workspace_member_id,
        ai_agent_id,
        workspace_id,
        channel_id,
        conversation_id,
        parent_message_id,
        thread_id,
        message_type,
        sender_type,
        created_at,
        updated_at,
        edited_at,
        deleted_at,
        blocks,
        metadata`,
    [
      conversationId,
      workspaceId,
      content,
      content, // text field for search
      senderType,
      workspaceMemberId,
      agentId,
    ],
  );

  // Update conversation timestamp
  await client.query(
    `UPDATE conversations
     SET updated_at = NOW()
     WHERE id = $1`,
    [conversationId],
  );

  const savedMessage = messageResult.rows[0];

  // Return the message in the format expected by frontend
  const agentMessage: AgentMessageWithSender = {
    id: savedMessage.id,
    body: savedMessage.body,
    workspace_member_id: savedMessage.workspace_member_id,
    ai_agent_id: savedMessage.ai_agent_id,
    workspace_id: savedMessage.workspace_id,
    channel_id: savedMessage.channel_id,
    conversation_id: savedMessage.conversation_id,
    parent_message_id: savedMessage.parent_message_id,
    thread_id: savedMessage.thread_id,
    message_type: savedMessage.message_type,
    sender_type: savedMessage.sender_type,
    created_at: savedMessage.created_at,
    updated_at: savedMessage.updated_at,
    edited_at: savedMessage.edited_at,
    deleted_at: savedMessage.deleted_at,
    blocks: savedMessage.blocks,
    metadata: savedMessage.metadata,
    reactions: [], // No reactions on new messages
    attachments: [], // No attachments in this context (could be extended later)
  };

  return agentMessage;
}

export async function getConversationHistory(
  client: PoolClient,
  conversationId: string,
  limit: number = 20,
): Promise<any[]> {
  const result = await client.query(
    `SELECT
       m.id,
       m.body as content,
       m.sender_type,
       m.metadata,
       m.created_at,
       wm.user_id,
       u.name as user_name,
       a.name as agent_name,
       a.id as agent_id
     FROM messages m
     LEFT JOIN workspace_members wm ON m.workspace_member_id = wm.id
     LEFT JOIN users u ON wm.user_id = u.id
     LEFT JOIN agents a ON m.ai_agent_id = a.id
     WHERE m.conversation_id = $1
     ORDER BY m.created_at DESC
     LIMIT $2`,
    [conversationId, limit],
  );

  return result.rows.reverse(); // Return in chronological order
}

// Helper function to get user's AI conversations
export async function getUserAiConversations(
  client: PoolClient,
  workspaceId: string,
  workspaceMemberId: string,
): Promise<AiConversation[]> {
  const result = await client.query(
    `SELECT DISTINCT c.*
     FROM conversations c
     INNER JOIN conversation_members cm_user ON c.id = cm_user.conversation_id
     INNER JOIN conversation_members cm_agent ON c.id = cm_agent.conversation_id
     WHERE c.workspace_id = $1
       AND cm_user.workspace_member_id = $2
       AND cm_agent.ai_agent_id IS NOT NULL
     ORDER BY c.updated_at DESC`,
    [workspaceId, workspaceMemberId],
  );

  return result.rows;
}
