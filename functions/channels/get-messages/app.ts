import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import dbPool from '../../common/utils/create-db-pool';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { successResponse, errorResponse } from '../../common/utils/response';
import type { ChannelMemberWithUser } from '../types';
import type { MessageWithUser } from '../../common/types';

// Validation schemas
const PathParamsSchema = z.object({
  channelId: z.string().uuid('channelId is required'),
  workspaceId: z.string().uuid('workspaceId is required'),
});

const QueryParamsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
  before: z.string().datetime().optional(),
  include_members: z.enum(['true', 'false']).default('false'),
  include_reactions: z.enum(['true', 'false']).default('true'),
  include_attachments: z.enum(['true', 'false']).default('true'),
  include_count: z.enum(['true', 'false']).default('false'),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  let client: PoolClient | null = null;

  try {
    // 1) Validate
    const pathParams = PathParamsSchema.parse(event.pathParameters);
    const queryParams = QueryParamsSchema.parse(event.queryStringParameters || {});
    const { channelId, workspaceId } = pathParams;
    const {
      limit,
      cursor,
      before,
      include_members,
      include_reactions,
      include_attachments,
      include_count,
    } = queryParams;

    // 2) Authenticate
    const userId = await getUserIdFromToken(event.headers.Authorization);
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    client = await dbPool.connect();

    // 3) Mega‐query: top‐level messages + thread stats + reactions + attachments
    const mainQuery = `
      WITH cursor_timestamp AS (
        SELECT created_at
        FROM messages
        WHERE id = $3
      ),
      channel_access AS (
        SELECT
          c.id,
          c.name,
          c.description,
          c.channel_type,
          cm.role,
          cm.notifications_enabled,
          cm.last_read_message_id,
          CASE WHEN cm.id IS NOT NULL THEN true ELSE false END AS is_member
        FROM channels c
        LEFT JOIN workspace_members wm
          ON wm.workspace_id = c.workspace_id
          AND wm.user_id = $2 AND wm.is_deactivated IS false
        LEFT JOIN channel_members cm
          ON cm.channel_id = c.id
          AND cm.workspace_member_id = wm.id
        WHERE
          c.id = $1
          AND c.workspace_id = $4
          AND (cm.id IS NOT NULL OR c.channel_type = 'public')
      ),
      filtered_messages AS (
        SELECT m.*
        FROM messages m, channel_access ca
        WHERE
          m.channel_id = $1
          AND m.deleted_at IS NULL
          AND m.parent_message_id IS NULL
          AND ($3::uuid IS NULL OR m.created_at < (SELECT created_at FROM cursor_timestamp))
          AND ($5::timestamp IS NULL OR m.created_at < $5::timestamp)
        ORDER BY m.created_at DESC
        LIMIT $6 + 1
      ),
      thread_stats AS (
        SELECT
          m.thread_id            AS root_id,
          COUNT(*)               AS thread_reply_count,
          MAX(m.created_at)      AS last_reply_at,           -- ← last reply timestamp
          COALESCE(
            json_agg(DISTINCT ru.id) FILTER (WHERE ru.id IS NOT NULL),
            '[]'::json
          )                       AS thread_participants
        FROM messages m
        JOIN workspace_members rwm
          ON m.workspace_member_id = rwm.id
        JOIN users ru
          ON rwm.user_id = ru.id
        WHERE
          m.channel_id = $1
          AND m.deleted_at IS NULL
          AND m.parent_message_id IS NOT NULL
        GROUP BY m.thread_id
      ),
      message_reactions AS (
        SELECT
          fm.id AS message_id,
          CASE WHEN $7 = 'true' THEN
            COALESCE(
              json_agg(
                jsonb_build_object(
                  'id', r.id,
                  'value', r.value,
                  'user_id', ru.id,
                  'user_name', ru.name
                )
              ) FILTER (WHERE r.id IS NOT NULL),
              '[]'::json
            )
          ELSE '[]'::json
          END AS reactions_data
        FROM filtered_messages fm
        LEFT JOIN reactions r
          ON r.message_id = fm.id AND $7 = 'true'
        LEFT JOIN workspace_members rwm
          ON r.workspace_member_id = rwm.id AND $7 = 'true'
        LEFT JOIN users ru
          ON rwm.user_id = ru.id AND $7 = 'true'
        GROUP BY fm.id
      ),
      message_attachments AS (
        SELECT
          fm.id AS message_id,
          CASE WHEN $8 = 'true' THEN
            COALESCE(
              json_agg(
                jsonb_build_object(
                  'id', uf.id,
                  'original_filename', uf.original_filename,
                  'public_url', uf.public_url,
                  'content_type', uf.content_type,
                  'size_bytes', uf.size_bytes,
                  'order_index', ma.order_index
                ) ORDER BY ma.order_index
              ) FILTER (WHERE uf.id IS NOT NULL),
              '[]'::json
            )
          ELSE '[]'::json
          END AS attachments_data
        FROM filtered_messages fm
        LEFT JOIN message_attachments ma
          ON ma.message_id = fm.id AND $8 = 'true'
        LEFT JOIN uploaded_files uf
          ON ma.uploaded_file_id = uf.id AND $8 = 'true'
        GROUP BY fm.id
      ),
      enriched_messages AS (
        SELECT
          fm.*,
          u.id                AS user_id,
          u.name              AS user_name,
          u.email             AS user_email,
          u.image             AS user_image,
          us.status           AS user_status,
          us.custom_status,
          us.status_emoji,
          us.last_seen_at,
          mr.reactions_data,
          ma.attachments_data,
          COALESCE(ts.thread_reply_count, 0)     AS thread_reply_count,
          ts.last_reply_at                      AS thread_last_reply_at,
          COALESCE(ts.thread_participants, '[]') AS thread_participants
        FROM filtered_messages fm
        JOIN workspace_members wm
          ON fm.workspace_member_id = wm.id
        JOIN users u
          ON wm.user_id = u.id
        LEFT JOIN user_status us
          ON us.user_id = u.id AND us.workspace_id = $4
        LEFT JOIN message_reactions mr
          ON mr.message_id = fm.id
        LEFT JOIN message_attachments ma
          ON ma.message_id = fm.id
        LEFT JOIN thread_stats ts
          ON ts.root_id = fm.id
        ORDER BY fm.created_at DESC
      )
      SELECT
        ca.id                   AS channel_id,
        ca.name                 AS channel_name,
        ca.description          AS channel_description,
        ca.channel_type,
        ca.role                 AS user_role,
        ca.notifications_enabled AS user_notifications,
        ca.last_read_message_id AS user_last_read,
        ca.is_member,
        COALESCE(
          json_agg(
            json_build_object(
              'id',                     em.id,
              'body',                   em.body,
              'workspace_member_id',    em.workspace_member_id,
              'workspace_id',           em.workspace_id,
              'channel_id',             em.channel_id,
              'conversation_id',        em.conversation_id,
              'parent_message_id',      em.parent_message_id,
              'thread_id',              em.thread_id,
              'message_type',           em.message_type,
              'created_at',             em.created_at,
              'updated_at',             em.updated_at,
              'edited_at',              em.edited_at,
              'deleted_at',             em.deleted_at,
              'blocks',                 em.blocks,
              'metadata',               em.metadata,
              'user', json_build_object(
                'id',               em.user_id,
                'name',             em.user_name,
                'email',            em.user_email,
                'image',            em.user_image,
                'status',           em.user_status,
                'custom_status',    em.custom_status,
                'status_emoji',     em.status_emoji,
                'last_seen_at',     em.last_seen_at
              ),
              'reactions',             em.reactions_data,
              'attachments',           em.attachments_data,
              'thread_reply_count',    em.thread_reply_count,
              'thread_last_reply_at',  em.thread_last_reply_at,
              'thread_participants',   em.thread_participants
            ) ORDER BY em.created_at DESC
          ) FILTER (WHERE em.id IS NOT NULL),
          '[]'::json
        ) AS messages_data
      FROM channel_access ca
      LEFT JOIN enriched_messages em ON true
      GROUP BY
        ca.id, ca.name, ca.description, ca.channel_type,
        ca.role, ca.notifications_enabled,
        ca.last_read_message_id, ca.is_member;
    `;

    const { rows } = await client.query(mainQuery, [
      channelId, // $1
      userId, // $2
      cursor || null, // $3
      workspaceId, // $4
      before || null, // $5
      limit, // $6
      include_reactions, // $7
      include_attachments, // $8
    ]);

    if (rows.length === 0) {
      return errorResponse('Channel not found or access denied', 403);
    }
    const result = rows[0];
    if (!result.is_member && result.channel_type !== 'public') {
      return errorResponse('Access denied', 403);
    }

    // Pagination
    const raw = result.messages_data || [];
    const hasMore = raw.length > limit;
    const slice = hasMore ? raw.slice(0, limit) : raw;
    const nextCursor = hasMore && slice.length > 0 ? slice[slice.length - 1].id : null;

    // Reactions grouping
    const messages: MessageWithUser[] = slice.map((msg: any) => {
      const map: Record<string, any> = {};
      (msg.reactions || []).forEach((r: any) => {
        if (!map[r.value]) {
          map[r.value] = { id: `${msg.id}_${r.value}`, value: r.value, count: 0, users: [] };
        }
        map[r.value].count++;
        map[r.value].users.push({ id: r.user_id, name: r.user_name });
      });
      return { ...msg, reactions: Object.values(map) };
    });

    // Channel members
    let channelMembers: ChannelMemberWithUser[] = [];
    if (include_members === 'true') {
      const membersQuery = `
        SELECT
          cm.id,
          cm.workspace_member_id,
          cm.role,
          cm.joined_at,
          cm.notifications_enabled,
          cm.last_read_message_id,
          u.id   AS user_id,
          u.name AS user_name,
          u.email AS user_email,
          u.image AS user_image
        FROM channel_members cm
        JOIN workspace_members wm
          ON cm.workspace_member_id = wm.id
        JOIN users u
          ON wm.user_id = u.id
        WHERE cm.channel_id = $1
        ORDER BY cm.joined_at ASC
      `;
      const { rows: memRows } = await client.query(membersQuery, [channelId]);
      channelMembers = memRows.map((m) => ({
        id: m.id,
        workspace_member_id: m.workspace_member_id,
        role: m.role,
        joined_at: m.joined_at,
        notifications_enabled: m.notifications_enabled,
        last_read_message_id: m.last_read_message_id,
        channel_id: channelId,
        user: {
          id: m.user_id,
          name: m.user_name,
          email: m.user_email,
          image: m.user_image,
        },
      }));
    }

    // Total count
    let totalCount = 0;
    if (include_count === 'true') {
      const cntQ = `
        SELECT COUNT(*) AS total
        FROM messages
        WHERE channel_id = $1 AND deleted_at IS NULL
      `;
      const { rows: cntRows } = await client.query(cntQ, [channelId]);
      totalCount = parseInt(cntRows[0]?.total || '0', 10);
    }

    return successResponse({
      channel: {
        id: result.channel_id,
        name: result.channel_name,
        description: result.channel_description,
        channel_type: result.channel_type,
      },
      messages,
      members: channelMembers,
      pagination: { hasMore, nextCursor, totalCount },
      user_channel_data: result.is_member
        ? {
            role: result.user_role,
            notifications_enabled: result.user_notifications,
            last_read_message_id: result.user_last_read,
          }
        : null,
    });
  } catch (error) {
    console.error('Error fetching channel messages:', error);
    if (error instanceof z.ZodError) {
      return errorResponse(
        `Validation error: ${error.errors.map((e) => e.message).join(', ')}`,
        400,
      );
    }
    return errorResponse('Internal server error', 500);
  } finally {
    if (client) {
      client.release();
    }
  }
};
