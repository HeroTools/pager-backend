import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

const PathParamsSchema = z.object({
  workspaceId: z.string().uuid('workspaceId is required'),
  messageId: z.string().uuid('messageId is required'),
});

const QueryParamsSchema = z.object({
  include_reactions: z.enum(['true', 'false']).default('true'),
  include_attachments: z.enum(['true', 'false']).default('true'),
});

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client: PoolClient | null = null;

    try {
      const { workspaceId, messageId } = PathParamsSchema.parse(event.pathParameters);
      const { include_reactions, include_attachments } = QueryParamsSchema.parse(
        event.queryStringParameters || {},
      );

      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) return errorResponse('Unauthorized', 401);

      client = await dbPool.connect();

      const sql = `
      WITH
      msg AS (
        SELECT * FROM messages
        WHERE id = $1 AND deleted_at IS NULL
      ),
      access AS (
        SELECT
          -- check conversation access
          (
            msg.conversation_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM conversations c
              JOIN workspace_members wm
                ON wm.workspace_id = c.workspace_id
               AND wm.user_id = $3
               AND wm.is_deactivated IS FALSE
              JOIN conversation_members cm
                ON cm.conversation_id = c.id
               AND cm.workspace_member_id = wm.id
               AND cm.left_at IS NULL
              WHERE c.id = msg.conversation_id
                AND c.workspace_id = $2
            )
          )
          OR
          -- check channel access (public or membership)
          (
            msg.channel_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM channels ch
              LEFT JOIN workspace_members wm2
                ON wm2.workspace_id = ch.workspace_id
               AND wm2.user_id = $3
               AND wm2.is_deactivated IS FALSE
              LEFT JOIN channel_members cm2
                ON cm2.channel_id = ch.id
               AND cm2.workspace_member_id = wm2.id
              WHERE ch.id = msg.channel_id
                AND ch.workspace_id = $2
                AND (ch.channel_type = 'public' OR cm2.id IS NOT NULL)
            )
          ) AS has_access
        FROM msg
      ),
      msg_user AS (
        SELECT
          m.*,
          u.id    AS user_id,
          u.name  AS user_name,
          u.email AS user_email,
          u.image AS user_image
        FROM msg m
        JOIN workspace_members wm3
          ON m.workspace_member_id = wm3.id
        JOIN users u
          ON wm3.user_id = u.id
      ),
      thread_stats AS (
        SELECT
          m.thread_id           AS root_id,
          COUNT(*)              AS thread_reply_count,
          MAX(m.created_at)     AS thread_last_reply_at,
          COALESCE(
            json_agg(DISTINCT ru.id) FILTER (WHERE ru.id IS NOT NULL),
            '[]'
          ) AS thread_participants
        FROM messages m
        JOIN workspace_members rwm
          ON m.workspace_member_id = rwm.id
        JOIN users ru
          ON rwm.user_id = ru.id
        WHERE
          m.thread_id IS NOT NULL
          AND m.deleted_at IS NULL
          AND m.thread_id = (SELECT id FROM msg)
        GROUP BY m.thread_id
      ),
      msg_reactions AS (
        SELECT
          mq.id AS message_id,
          CASE WHEN $4 = 'true' THEN
            COALESCE(
              json_agg(
                jsonb_build_object(
                  'id',        r.id,
                  'value',     r.value,
                  'user_id',   ru.id,
                  'user_name', ru.name
                )
              ) FILTER (WHERE r.id IS NOT NULL),
              '[]'
            )
          ELSE '[]' END AS reactions_data
        FROM msg mq
        LEFT JOIN reactions r
          ON r.message_id = mq.id
         AND $4 = 'true'
        LEFT JOIN workspace_members rwm2
          ON r.workspace_member_id = rwm2.id
         AND $4 = 'true'
        LEFT JOIN users ru
          ON rwm2.user_id = ru.id
         AND $4 = 'true'
        GROUP BY mq.id
      ),
      msg_attachments AS (
        SELECT
          mq.id AS message_id,
          CASE WHEN $5 = 'true' THEN
            COALESCE(
              json_agg(
                jsonb_build_object(
                  'id',                uf.id,
                  'original_filename', uf.original_filename,
                  'public_url',        uf.public_url,
                  'content_type',      uf.content_type,
                  'size_bytes',        uf.size_bytes,
                  'order_index',       ma.order_index
                )
                ORDER BY ma.order_index
              ) FILTER (WHERE uf.id IS NOT NULL),
              '[]'
            )
          ELSE '[]' END AS attachments_data
        FROM msg mq
        LEFT JOIN message_attachments ma
          ON ma.message_id = mq.id
         AND $5 = 'true'
        LEFT JOIN uploaded_files uf
          ON ma.uploaded_file_id = uf.id
         AND $5 = 'true'
        GROUP BY mq.id
      )
      SELECT
        a.has_access,
        mu.*,
        ts.thread_reply_count,
        ts.thread_last_reply_at,
        ts.thread_participants,
        mr.reactions_data    AS reactions,
        ma.attachments_data  AS attachments
      FROM access a
      JOIN msg_user mu       ON TRUE
      LEFT JOIN thread_stats ts ON ts.root_id = mu.id
      LEFT JOIN msg_reactions mr ON mr.message_id = mu.id
      LEFT JOIN msg_attachments ma ON ma.message_id = mu.id;
      `;

      const { rows } = await client.query(sql, [
        messageId, // $1
        workspaceId, // $2
        userId, // $3
        include_reactions, // $4
        include_attachments, // $5
      ]);

      // 4) Access check
      if (rows.length === 0 || !rows[0].has_access) {
        return errorResponse('Message not found or access denied', 403);
      }

      const r = rows[0];
      const message = {
        id: r.id,
        body: r.body,
        parent_message_id: r.parent_message_id,
        thread_id: r.thread_id,
        channel_id: r.channel_id,
        conversation_id: r.conversation_id,
        workspace_member_id: r.workspace_member_id,
        message_type: r.message_type,
        created_at: r.created_at,
        updated_at: r.updated_at,
        edited_at: r.edited_at,
        deleted_at: r.deleted_at,
        blocks: r.blocks,
        metadata: r.metadata,
        user: {
          id: r.user_id,
          name: r.user_name,
          email: r.user_email,
          image: r.user_image,
        },
        reactions: r.reactions,
        attachments: r.attachments,
        thread_reply_count: r.thread_reply_count || 0,
        thread_last_reply_at: r.thread_last_reply_at,
        thread_participants: r.thread_participants || [],
      };

      return successResponse({ message });
    } catch (err) {
      console.error('get-message-by-id error:', err);
      if (err instanceof z.ZodError) {
        return errorResponse(
          `Validation error: ${err.errors.map((e) => e.message).join(', ')}`,
          400,
        );
      }
      return errorResponse('Internal server error', 500);
    } finally {
      client?.release();
    }
  },
);
