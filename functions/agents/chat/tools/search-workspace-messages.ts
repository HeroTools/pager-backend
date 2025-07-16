// src/tools/search-workspace-messages.ts
import { tool } from '@openai/agents';
import { registerTypes, toSql } from 'pgvector/pg';
import { z } from 'zod';
import dbPool from '../../../common/utils/create-db-pool';
import { createEmbedding } from '../../../common/utils/create-embedding';

export const searchWorkspaceMessages = tool({
  name: 'search_workspace_messages',
  description:
    'Search workspace messages with optional time filtering. Use this when users ask about information from their workspace history. Searches only human team messages, excludes AI chat conversations.',
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
      .max(50)
      .default(10)
      .describe('Maximum number of results to return'),
  }),
  async execute(params, context) {
    const { workspaceId, userId } = context?.context;

    try {
      // Create embedding for semantic search
      const embedding = await createEmbedding(params.query);

      const client = await dbPool.connect();
      await registerTypes(client);
      try {
        // Build dynamic query based on filters
        const filters = [];
        const values = [workspaceId, userId, toSql(embedding), 0.6, params.limit];
        let paramIndex = 6;

        // Handle timeframe (now using separate start/end fields)
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

        console.log(
          workspaceId,
          userId,
          params.limit,
          params.timeframe_start,
          params.timeframe_end,
          params.channel_id,
          params.channel_name,
        );

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
              ac.channel_name,
              CASE
                WHEN me.channel_id IS NOT NULL THEN 'channel'
                WHEN me.conversation_id IS NOT NULL THEN 'conversation'
                ELSE 'unknown'
              END AS context_type
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
            conversation_id,
            context_type
          FROM search_results
          ORDER BY similarity DESC;
        `;

        const result = await client.query(sql, values);

        console.log('SEARCH', result.rows);

        return {
          results: result.rows.map((row) => ({
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
            contextType: row.context_type,
          })),
          query: params.query,
          totalFound: result.rows.length,
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
      console.error('Search workspace messages error:', error);
      return {
        results: [],
        query: params.query,
        totalFound: 0,
        error: error.message,
      };
    }
  },
});
