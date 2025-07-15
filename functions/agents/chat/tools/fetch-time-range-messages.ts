// src/tools/fetch-time-range-messages.ts
import { tool } from '@openai/agents';
import { z } from 'zod';
import dbPool from '../../../common/utils/create-db-pool';

export const fetchTimeRangeMessages = tool({
  name: 'fetch_time_range_messages',
  description:
    'Fetch messages chronologically within a time range for comprehensive summaries and analysis. Use this for broader temporal queries like "what happened yesterday" rather than specific searches.',
  parameters: z.object({
    timeframe_start: z.string().datetime().describe('Start time in ISO format'),
    timeframe_end: z.string().datetime().describe('End time in ISO format'),
    channel_id: z
      .string()
      .nullable()
      .describe('Channel ID to filter to specific channel (null for all accessible channels)'),
    channel_name: z
      .string()
      .nullable()
      .describe('Channel name to filter to specific channel (null for all accessible channels)'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe('Maximum number of messages to return'),
    offset: z.number().int().min(0).default(0).describe('Offset for pagination'),
    include_system_messages: z
      .boolean()
      .default(false)
      .describe('Include system messages in results'),
    group_by_channel: z
      .boolean()
      .default(true)
      .describe('Group results by channel/conversation for easier analysis'),
  }),
  async execute(params, context) {
    const { workspaceId, userId } = context?.context;

    try {
      const client = await dbPool.connect();
      try {
        // First, get a count to check if we're dealing with a large dataset
        const countSql = `
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
          )
          SELECT COUNT(*) as total_messages
          FROM messages m
          JOIN workspace_members wm ON m.workspace_member_id = wm.id
          LEFT JOIN accessible_channels ac ON m.channel_id = ac.channel_id
          LEFT JOIN accessible_conversations aconv ON m.conversation_id = aconv.conversation_id
          WHERE m.workspace_id = $1
            AND m.created_at BETWEEN $3 AND $4
            AND m.deleted_at IS NULL
            AND (
              (m.channel_id IS NOT NULL AND ac.channel_id IS NOT NULL)
              OR
              (m.conversation_id IS NOT NULL AND aconv.conversation_id IS NOT NULL)
            )
            ${params.channel_id ? 'AND m.channel_id = $5' : ''}
            ${params.channel_name && !params.channel_id ? 'AND ac.channel_name ILIKE $5' : ''}
        `;

        const countValues = [workspaceId, userId, params.timeframe_start, params.timeframe_end];
        if (params.channel_id) {
          countValues.push(params.channel_id);
        } else if (params.channel_name) {
          countValues.push(`%${params.channel_name}%`);
        }

        const countResult = await client.query(countSql, countValues);
        const totalMessages = parseInt(countResult.rows[0].total_messages);

        // If we have a large dataset, provide a warning
        const isLargeDataset = totalMessages > 200;

        // Build the main query
        const filters = [];
        const values = [workspaceId, userId, params.timeframe_start, params.timeframe_end];
        let paramIndex = 5;

        if (params.channel_id) {
          filters.push(`m.channel_id = $${paramIndex}`);
          values.push(params.channel_id);
          paramIndex++;
        }

        if (params.channel_name && !params.channel_id) {
          filters.push(`ac.channel_name ILIKE $${paramIndex}`);
          values.push(`%${params.channel_name}%`);
          paramIndex++;
        }

        values.push(params.limit, params.offset);
        const limitParam = paramIndex;
        const offsetParam = paramIndex + 1;

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
          )
          SELECT
            m.id AS message_id,
            COALESCE(m.text, m.body) AS content,
            m.created_at,
            m.updated_at,
            m.edited_at,
            m.message_type,
            m.parent_message_id,
            m.thread_id,
            u.name AS author_name,
            u.image AS author_image,
            u.id AS author_id,
            m.channel_id,
            ac.channel_name,
            m.conversation_id,
            CASE
              WHEN m.channel_id IS NOT NULL THEN 'channel'
              WHEN m.conversation_id IS NOT NULL THEN 'conversation'
              ELSE 'unknown'
            END AS context_type,
            CASE
              WHEN m.parent_message_id IS NOT NULL THEN true
              ELSE false
            END AS is_thread_reply
          FROM messages m
          JOIN workspace_members wm ON m.workspace_member_id = wm.id
          JOIN users u ON wm.user_id = u.id
          LEFT JOIN accessible_channels ac ON m.channel_id = ac.channel_id
          LEFT JOIN accessible_conversations aconv ON m.conversation_id = aconv.conversation_id
          WHERE m.workspace_id = $1
            AND m.created_at BETWEEN $3 AND $4
            AND m.deleted_at IS NULL
            AND (
              (m.channel_id IS NOT NULL AND ac.channel_id IS NOT NULL)
              OR
              (m.conversation_id IS NOT NULL AND aconv.conversation_id IS NOT NULL)
            )
            ${whereClause}
          ORDER BY m.created_at ASC
          LIMIT $${limitParam} OFFSET $${offsetParam}
        `;

        const result = await client.query(sql, values);

        // Group messages by context if requested
        const messages = result.rows.map((row) => ({
          messageId: row.message_id,
          content: row.content,
          timestamp: row.created_at,
          updatedAt: row.updated_at,
          editedAt: row.edited_at,
          messageType: row.message_type,
          parentMessageId: row.parent_message_id,
          threadId: row.thread_id,
          author: {
            id: row.author_id,
            name: row.author_name,
            image: row.author_image,
          },
          channelId: row.channel_id,
          channelName: row.channel_name,
          conversationId: row.conversation_id,
          contextType: row.context_type,
          isThreadReply: row.is_thread_reply,
        }));

        let groupedMessages = null;
        if (params.group_by_channel) {
          groupedMessages = messages.reduce(
            (acc, message) => {
              const key =
                message.contextType === 'channel'
                  ? `channel:${message.channelId}`
                  : `conversation:${message.conversationId}`;

              if (!acc[key]) {
                acc[key] = {
                  contextType: message.contextType,
                  contextId:
                    message.contextType === 'channel' ? message.channelId : message.conversationId,
                  contextName:
                    message.contextType === 'channel' ? message.channelName : 'Direct Message',
                  messages: [],
                };
              }

              acc[key].messages.push(message);
              return acc;
            },
            {} as Record<string, any>,
          );
        }

        return {
          messages,
          groupedMessages,
          totalMessages,
          returnedCount: result.rows.length,
          isLargeDataset,
          timeframe: {
            start: params.timeframe_start,
            end: params.timeframe_end,
          },
          pagination: {
            limit: params.limit,
            offset: params.offset,
            hasMore: params.offset + result.rows.length < totalMessages,
          },
          warning: isLargeDataset
            ? `Large dataset detected (${totalMessages} messages). Consider filtering by channel or using smaller time ranges for better performance.`
            : null,
        };
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Fetch time range messages error:', error);
      return {
        messages: [],
        groupedMessages: null,
        totalMessages: 0,
        returnedCount: 0,
        error: error.message,
        timeframe: {
          start: params.timeframe_start,
          end: params.timeframe_end,
        },
      };
    }
  },
});
