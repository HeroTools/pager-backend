// src/tools/search-workspace-messages.ts
import { tool } from '@openai/agents';
import { registerTypes, toSql } from 'pgvector/pg';
import { z } from 'zod';
import dbPool from '../../../common/utils/create-db-pool';
import { createEmbedding } from '../../../common/utils/create-embedding';
import { summarizingProcessor } from '../helpers/efficient-message-processor';

export const searchWorkspaceMessages = tool({
  name: 'search_workspace_messages',
  description: `Search workspace messages with smart preprocessing to avoid token limits.

  Enhanced features:
  - Automatically filters low-quality/boilerplate messages
  - Scores messages by importance (decisions, actions, questions get priority)
  - Limits results to most relevant messages to stay within token limits
  - Provides metadata about search quality and suggestions

  Use this when users ask about specific topics, decisions, or information from workspace history.`,

  parameters: z.object({
    query: z.string().describe('The search query to find relevant messages'),
    timeframe_start: z
      .string()
      .datetime()
      .nullable()
      .describe('Start time in ISO format (null if no time filter)'),
    timeframe_end: z
      .string()
      .datetime()
      .nullable()
      .describe('End time in ISO format (null if no time filter)'),
    channel_name: z
      .string()
      .nullable()
      .describe('Channel name to filter to specific channel (null for all channels)'),
    channel_id: z
      .string()
      .nullable()
      .describe('Channel ID to filter to specific channel (null for all channels)'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200) // Increased since we'll filter down
      .default(50)
      .describe(
        'Maximum number of results to retrieve from database (will be filtered for quality)',
      ),
  }),

  async execute(params, context) {
    const { workspaceId, userId } = context?.context;

    try {
      console.log('🔍 Enhanced search starting:', { query: params.query, limit: params.limit });

      const embedding = await createEmbedding(params.query);

      const client = await dbPool.connect();
      await registerTypes(client);

      try {
        const filters = [];
        const values = [workspaceId, userId, toSql(embedding), 0.6, params.limit];
        let paramIndex = 6;

        if (params.timeframe_start && params.timeframe_end) {
          filters.push(`m.created_at BETWEEN $${paramIndex} AND $${paramIndex + 1}`);
          values.push(params.timeframe_start, params.timeframe_end);
          paramIndex += 2;
        }

        if (params.channel_id) {
          filters.push(`me.channel_id = $${paramIndex}`);
          values.push(params.channel_id);
          paramIndex++;
        }

        if (params.channel_name && !params.channel_id) {
          filters.push(`ac.channel_name ILIKE $${paramIndex}`);
          values.push(`%${params.channel_name}%`);
          paramIndex++;
        }

        const whereClause = filters.length ? `AND ${filters.join(' AND ')}` : '';

        const sql = `
          WITH user_workspace_member AS (
            SELECT id AS workspace_member_id
            FROM workspace_members
            WHERE user_id = $2 AND workspace_id = $1 AND is_deactivated = false
          ),
          accessible_channels AS (
            SELECT c.id AS channel_id, c.name AS channel_name
            FROM channels c
            JOIN channel_members cm ON c.id = cm.channel_id
            JOIN workspace_members wm ON cm.workspace_member_id = wm.id
            WHERE c.workspace_id = $1
              AND c.deleted_at IS NULL
              AND cm.left_at IS NULL
              AND wm.user_id = $2
          ),
          accessible_conversations AS (
            SELECT conv.id AS conversation_id
            FROM conversations conv
            JOIN conversation_members convm ON conv.id = convm.conversation_id
            JOIN workspace_members wm ON convm.workspace_member_id = wm.id
            WHERE conv.workspace_id = $1
              AND convm.left_at IS NULL
              AND convm.is_hidden = false
              AND wm.user_id = $2
              AND NOT EXISTS (
                SELECT 1 FROM conversation_members cm_agent
                WHERE cm_agent.conversation_id = conv.id
                  AND cm_agent.ai_agent_id IS NOT NULL
              )
          ),
          search_results AS (
            SELECT
              me.message_id,
              1 - (me.embedding <=> $3) AS similarity,
              me.channel_id,
              me.conversation_id,
              m.body,
              m.text,
              m.created_at,
              m.sender_type,
              u.name AS author_name,
              u.image AS author_image,
              ac.channel_name
            FROM message_embeddings me
            JOIN messages m ON me.message_id = m.id
            JOIN workspace_members wm ON m.workspace_member_id = wm.id
            JOIN users u ON wm.user_id = u.id
            LEFT JOIN accessible_channels ac ON me.channel_id = ac.channel_id
            LEFT JOIN accessible_conversations aconv ON me.conversation_id = aconv.conversation_id
            WHERE me.workspace_id = $1
              AND (me.embedding <=> $3) < $4
              AND m.deleted_at IS NULL
              AND m.sender_type = 'user'
              AND (
                (me.channel_id IS NOT NULL AND ac.channel_id IS NOT NULL)
                OR
                (me.conversation_id IS NOT NULL AND aconv.conversation_id IS NOT NULL)
              )
              ${whereClause}
            ORDER BY similarity DESC
            LIMIT $5
          )
          SELECT
            message_id,
            COALESCE(text, body) AS content,
            similarity,
            created_at,
            sender_type,
            author_name,
            author_image,
            channel_id,
            channel_name,
            conversation_id
          FROM search_results
          ORDER BY similarity DESC;
        `;

        const result = await client.query(sql, values);
        console.log(`📊 Database returned ${result.rows.length} raw messages`);

        if (result.rows.length === 0) {
          return {
            results: [],
            query: params.query,
            totalFound: 0,
            processedCount: 0,
            metadata: {
              avgImportance: 0,
              messageTypes: {},
              recommendation: 'No messages found - try broader search terms',
            },
            timeframe:
              params.timeframe_start && params.timeframe_end
                ? {
                    start: params.timeframe_start,
                    end: params.timeframe_end,
                  }
                : null,
          };
        }

        const rawMessages = result.rows.map((row) => ({
          messageId: row.message_id,
          content: row.content,
          similarity: parseFloat(row.similarity),
          timestamp: row.created_at,
          senderType: row.sender_type,
          author: row.author_name,
          authorImage: row.author_image,
          channelId: row.channel_id,
          channelName: row.channel_name,
          conversationId: row.conversation_id,
          contextType: row.channel_id ? 'channel' : 'conversation',
          updatedAt: row.updated_at,
          editedAt: row.edited_at,
          messageType: row.message_type,
          parentMessageId: row.parent_message_id,
          threadId: row.thread_id,
          isThreadReply: row.parent_message_id !== null,
        }));

        // Process messages for quality and importance
        const processedMessages = await summarizingProcessor.process(rawMessages);

        console.log(`✅ Processed to ${processedMessages.length} high-quality messages`);

        return {
          results: processedMessages,
          query: params.query,
          totalFound: result.rows.length,
          processedCount: processedMessages.length,
          metadata: {
            processingApplied: true,
            qualityFilter: `Filtered ${result.rows.length} → ${processedMessages.length} messages`,
          },
          timeframe:
            params.timeframe_start && params.timeframe_end
              ? {
                  start: params.timeframe_start,
                  end: params.timeframe_end,
                }
              : null,
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('❌ Enhanced search error:', error);
      return {
        results: [],
        query: params.query,
        totalFound: 0,
        processedCount: 0,
        error: error.message,
      };
    }
  },
});
