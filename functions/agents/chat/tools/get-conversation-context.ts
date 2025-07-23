import { tool } from '@openai/agents';
import { z } from 'zod';
import dbPool from '../../../common/utils/create-db-pool';

export const getConversationContext = tool({
  name: 'get_conversation_context',
  description: 'Fetch recent messages and memory for an AI conversation',
  parameters: z.object({
    conversation_id: z.string().uuid().describe('The conversation ID to get context for'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe('Maximum number of recent messages to retrieve'),
  }),
  async execute({ conversation_id, limit }, context) {
    const { workspaceId, userId } = context?.context;
    const client = await dbPool.connect();

    try {
      // First verify this is an AI conversation that the user has access to
      const accessCheck = await client.query(
        `SELECT c.id
         FROM conversations c
         JOIN conversation_members cm_user ON c.id = cm_user.conversation_id
         JOIN workspace_members wm ON cm_user.workspace_member_id = wm.id
         WHERE c.id = $1
           AND c.workspace_id = $2
           AND wm.user_id = $3
           AND EXISTS (
             SELECT 1 FROM conversation_members cm_agent
             WHERE cm_agent.conversation_id = c.id
               AND cm_agent.ai_agent_id IS NOT NULL
           )`,
        [conversation_id, workspaceId, userId],
      );

      if (accessCheck.rows.length === 0) {
        return {
          messages: [],
          memory: [],
          conversation_id,
          success: false,
          error: 'Conversation not found or access denied',
        };
      }

      // Get recent messages from the conversation
      const msgs = await client.query(
        `SELECT
           m.id,
           COALESCE(m.text, m.body) as content,
           m.sender_type,
           m.created_at,
           m.metadata,
           CASE
             WHEN m.workspace_member_id IS NOT NULL THEN u.name
             WHEN m.ai_agent_id IS NOT NULL THEN a.name
             ELSE 'System'
           END as sender_name,
           CASE
             WHEN m.workspace_member_id IS NOT NULL THEN u.id
             WHEN m.ai_agent_id IS NOT NULL THEN a.id
             ELSE NULL
           END as sender_id
         FROM messages m
         LEFT JOIN workspace_members wm ON m.workspace_member_id = wm.id
         LEFT JOIN users u ON wm.user_id = u.id
         LEFT JOIN agents a ON m.ai_agent_id = a.id
         WHERE m.conversation_id = $1
           AND m.workspace_id = $2
           AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC
         LIMIT $3`,
        [conversation_id, workspaceId, limit],
      );

      // Get conversation memory
      const mem = await client.query(
        `SELECT memory_type, content, created_at, message_range_start, message_range_end
         FROM ai_conversation_memory
         WHERE conversation_id = $1 AND workspace_id = $2
         ORDER BY created_at DESC
         LIMIT 5`,
        [conversation_id, workspaceId],
      );

      console.log('Messages found:', msgs.rows.length);
      console.log('Memory entries found:', mem.rows.length);

      return {
        messages: msgs.rows.reverse(), // Chronological order
        memory: mem.rows,
        conversation_id,
        success: true,
      };
    } catch (error) {
      console.error('Error getting conversation context:', error);
      return {
        messages: [],
        memory: [],
        conversation_id,
        success: false,
        error: error.message,
      };
    } finally {
      client.release();
    }
  },
});
