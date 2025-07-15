import { tool } from '@openai/agents';
import { z } from 'zod';
import dbPool from '../../../common/utils/create-db-pool';

export const saveConversationMemory = tool({
  name: 'save_conversation_memory',
  description:
    'Persist a memory item for future context - use this to remember important facts, preferences, or context for the user',
  parameters: z.object({
    conversation_id: z.string().uuid().describe('The conversation ID to save memory for'),
    memory_type: z.enum(['fact', 'preference', 'context']).describe('Type of memory being saved'),
    content: z.string().min(1).describe('The memory content to save'),
  }),
  async execute(params, context) {
    const { workspaceId } = context?.context || {};
    const client = await dbPool.connect();
    try {
      await client.query(
        `INSERT INTO ai_conversation_memory
         (conversation_id, workspace_id, memory_type, content)
         VALUES ($1, $2, $3, $4)`,
        [params.conversation_id, workspaceId, params.memory_type, params.content],
      );
      return {
        success: true,
        memory_type: params.memory_type,
        content: params.content,
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
