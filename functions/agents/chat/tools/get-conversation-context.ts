import { tool } from '@openai/agents';
import { z } from 'zod';
import dbPool from '../../../common/utils/create-db-pool';

export const getConversationContext = tool({
  name: 'get_conversation_context',
  description: 'Fetch recent messages and memory for a conversation',
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
    const client = await dbPool.connect();
    try {
      const msgs = await client.query(
        `SELECT role, content, created_at, metadata FROM ai_messages
         WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [conversation_id, limit],
      );

      const mem = await client.query(
        `SELECT memory_type, content, created_at FROM ai_conversation_memory
         WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 5`,
        [conversation_id],
      );

      console.log(msgs.rows);
      console.log(mem.rows);

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
