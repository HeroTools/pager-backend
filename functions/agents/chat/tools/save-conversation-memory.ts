import { tool } from '@openai/agents';
import { z } from 'zod';
import dbPool from '../../../common/utils/create-db-pool';

export const saveConversationMemory = tool({
  name: 'save_conversation_memory',
  description:
    'Persist a memory item for future context - use this to remember important facts, preferences, or context for the user',
  parameters: z.object({
    conversation_id: z.string().uuid().describe('The conversation ID to save memory for'),
    memory_type: z
      .enum(['summary', 'key_facts', 'context'])
      .describe(
        'Type of memory being saved - summary: high-level conversation summaries, key_facts: important user facts/preferences, context: situational context',
      ),
    content: z.string().min(1).describe('The memory content to save'),
    message_range_start: z
      .string()
      .uuid()
      .nullable()
      .describe('Starting message ID for this memory context'),
    message_range_end: z
      .string()
      .uuid()
      .nullable()
      .describe('Ending message ID for this memory context'),
  }),
  async execute(params, context) {
    const { workspaceId, userId } = context?.context || {};
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
        [params.conversation_id, workspaceId, userId],
      );

      if (accessCheck.rows.length === 0) {
        return {
          success: false,
          error: 'Conversation not found or access denied',
        };
      }

      // Save the memory
      const result = await client.query(
        `INSERT INTO ai_conversation_memory
         (conversation_id, workspace_id, memory_type, content, message_range_start, message_range_end)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at`,
        [
          params.conversation_id,
          workspaceId,
          params.memory_type,
          params.content,
          params.message_range_start || null,
          params.message_range_end || null,
        ],
      );

      console.log(`Saved ${params.memory_type} memory for conversation ${params.conversation_id}`);

      return {
        success: true,
        memory_id: result.rows[0].id,
        memory_type: params.memory_type,
        content: params.content,
        created_at: result.rows[0].created_at,
        conversation_id: params.conversation_id,
      };
    } catch (error) {
      console.error('Error saving conversation memory:', error);
      return {
        success: false,
        error: error.message,
      };
    } finally {
      client.release();
    }
  },
});
