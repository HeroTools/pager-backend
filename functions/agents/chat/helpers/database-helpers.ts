import { PoolClient } from 'pg';

export interface AiConversation {
  id: string;
  workspace_id: string;
  user_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  last_message_at: string;
  metadata: any;
}

export async function getOrCreateConversation(
  client: PoolClient,
  workspaceId: string,
  userId: string,
  conversationId?: string,
): Promise<AiConversation> {
  if (conversationId) {
    const result = await client.query(
      `SELECT * FROM ai_conversations
         WHERE id = $1 AND workspace_id = $2 AND user_id = $3 AND status = 'active'`,
      [conversationId, workspaceId, userId],
    );

    if (result.rows[0]) {
      return result.rows[0];
    }
  }

  // Create new conversation
  const result = await client.query(
    `INSERT INTO ai_conversations (workspace_id, user_id, title, status)
       VALUES ($1, $2, $3, 'active')
       RETURNING *`,
    [workspaceId, userId, 'AI Conversation'],
  );

  return result.rows[0];
}

export async function saveAiMessage(
  client: PoolClient,
  conversationId: string,
  workspaceId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  metadata: any = {},
): Promise<void> {
  // Calculate token count (rough estimation)
  const tokenCount = Math.ceil(content.length / 4);

  await client.query(
    `INSERT INTO ai_messages (
        conversation_id,
        workspace_id,
        role,
        content,
        token_count,
        metadata,
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [conversationId, workspaceId, role, content, tokenCount, JSON.stringify(metadata)],
  );

  // Update conversation timestamp
  await client.query(
    `UPDATE ai_conversations
       SET last_message_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
    [conversationId],
  );
}

export async function getConversationHistory(
  client: PoolClient,
  conversationId: string,
  limit: number = 20,
): Promise<any[]> {
  const result = await client.query(
    `SELECT role, content, created_at, metadata
       FROM ai_messages
       WHERE conversation_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
    [conversationId, limit],
  );

  return result.rows.reverse(); // Return in chronological order
}
