import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import dbPool from '../../common/utils/create-db-pool';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { successResponse, errorResponse } from '../../common/utils/response';
import type { ConversationMemberWithUser } from '../types';
import type { MessageWithUser } from '../../common/types';

const PathParamsSchema = z.object({
    conversationId: z.string().uuid('conversationId is required'),
    workspaceId: z.string().uuid('workspaceId is required'),
});

const QueryParamsSchema = z.object({
    limit: z.coerce.number().min(1).max(100).default(50),
    cursor: z.string().uuid().optional(),
    before: z.string().datetime().optional(),
    include_members: z.enum(['true', 'false']).default('true'),
    include_reactions: z.enum(['true', 'false']).default('true'),
    include_attachments: z.enum(['true', 'false']).default('true'),
    include_count: z.enum(['true', 'false']).default('false'),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client: PoolClient | null = null;
    try {
        // Parse and validate
        const pathParams = PathParamsSchema.parse(event.pathParameters);
        const queryParams = QueryParamsSchema.parse(event.queryStringParameters || {});
        const { conversationId, workspaceId } = pathParams;
        const { limit, cursor, before, include_members, include_reactions, include_attachments, include_count } =
            queryParams;

        // Auth
        const userId = await getUserIdFromToken(event.headers.Authorization);
        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        client = await dbPool.connect();

        // Mega-query: top-level messages + thread stats + reactions + attachments
        const mainQuery = `
      WITH cursor_timestamp AS (
        SELECT created_at
        FROM messages
        WHERE id = $3
      ),
      conversation_access AS (
        SELECT
          c.id, c.workspace_id, c.created_at, c.updated_at,
          cm.id            AS member_id,
          cm.last_read_message_id,
          wm.id            AS workspace_member_id,
          CASE WHEN cm.id IS NOT NULL THEN true ELSE false END AS is_member
        FROM conversations c
        LEFT JOIN workspace_members wm
          ON wm.workspace_id = c.workspace_id
          AND wm.user_id = $2 AND wm.is_deactivated IS false
        LEFT JOIN conversation_members cm
          ON cm.conversation_id = c.id
          AND cm.workspace_member_id = wm.id
          AND cm.left_at IS NULL
        WHERE c.id = $1 AND c.workspace_id = $4
      ),
      filtered_messages AS (
        SELECT m.*
        FROM messages m, conversation_access ca
        WHERE
          m.conversation_id = $1
          AND m.deleted_at IS NULL
          AND m.parent_message_id IS NULL
          AND ($3::uuid IS NULL OR m.created_at < (SELECT created_at FROM cursor_timestamp))
          AND ($5::timestamp IS NULL OR m.created_at < $5::timestamp)
        ORDER BY m.created_at DESC
        LIMIT $6 + 1
      ),
      thread_stats AS (
        SELECT
          m.thread_id              AS root_id,
          COUNT(*)                 AS thread_reply_count,
          MAX(m.created_at)        AS thread_last_reply_at,
          COALESCE(
            json_agg(DISTINCT ru.id) FILTER (WHERE ru.id IS NOT NULL),
            '[]'::json
          )                        AS thread_participants
        FROM messages m
        JOIN workspace_members rwm
          ON m.workspace_member_id = rwm.id
        JOIN users ru
          ON rwm.user_id = ru.id
        WHERE
          m.conversation_id = $1
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
                  'id',        r.id,
                  'value',     r.value,
                  'user_id',   ru.id,
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
                  'id',               uf.id,
                  'original_filename',uf.original_filename,
                  'public_url',       uf.public_url,
                  'content_type',     uf.content_type,
                  'size_bytes',       uf.size_bytes,
                  'order_index',      ma.order_index
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
          u.id               AS user_id,
          u.name             AS user_name,
          u.email            AS user_email,
          u.image            AS user_image,
          us.status          AS user_status,
          us.custom_status,
          us.status_emoji,
          us.last_seen_at,
          mr.reactions_data,
          ma.attachments_data,
          COALESCE(ts.thread_reply_count, 0)     AS thread_reply_count,
          ts.thread_last_reply_at               AS thread_last_reply_at,
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
        ca.id                  AS conversation_id,
        ca.workspace_id,
        ca.created_at          AS conversation_created_at,
        ca.updated_at          AS conversation_updated_at,
        ca.member_id           AS user_member_id,
        ca.last_read_message_id AS user_last_read,
        ca.workspace_member_id AS user_workspace_member_id,
        ca.is_member,
        COALESCE(
          json_agg(
            json_build_object(
              'id',                 em.id,
              'body',               em.body,
              'workspace_member_id',em.workspace_member_id,
              'workspace_id',       em.workspace_id,
              'channel_id',         em.channel_id,
              'conversation_id',    em.conversation_id,
              'parent_message_id',  em.parent_message_id,
              'thread_id',          em.thread_id,
              'message_type',       em.message_type,
              'created_at',         em.created_at,
              'updated_at',         em.updated_at,
              'edited_at',          em.edited_at,
              'deleted_at',         em.deleted_at,
              'blocks',             em.blocks,
              'metadata',           em.metadata,
              'user', json_build_object(
                'id',           em.user_id,
                'name',         em.user_name,
                'email',        em.user_email,
                'image',        em.user_image,
                'status',       em.user_status,
                'custom_status',em.custom_status,
                'status_emoji', em.status_emoji,
                'last_seen_at', em.last_seen_at
              ),
              'reactions',          em.reactions_data,
              'attachments',        em.attachments_data,
              'thread_reply_count', em.thread_reply_count,
              'thread_last_reply_at',em.thread_last_reply_at,
              'thread_participants', em.thread_participants
            ) ORDER BY em.created_at DESC
          ) FILTER (WHERE em.id IS NOT NULL),
          '[]'::json
        ) AS messages_data
      FROM conversation_access ca
      LEFT JOIN enriched_messages em ON true
      GROUP BY
        ca.id, ca.workspace_id, ca.created_at, ca.updated_at,
        ca.member_id, ca.last_read_message_id,
        ca.workspace_member_id, ca.is_member;
    `;

        const { rows } = await client.query(mainQuery, [
            conversationId, // $1
            userId, // $2
            cursor || null, // $3
            workspaceId, // $4
            before || null, // $5
            limit, // $6
            include_reactions, // $7
            include_attachments, // $8
        ]);

        if (rows.length === 0) {
            return errorResponse('Conversation not found or access denied', 403);
        }
        const result = rows[0];
        if (!result.is_member) {
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

        // Conversation members
        let conversationMembers: ConversationMemberWithUser[] = [];
        if (include_members === 'true') {
            const membersQuery = `
        SELECT
          cm.id,
          cm.conversation_id,
          cm.workspace_member_id,
          cm.joined_at,
          cm.left_at,
          cm.last_read_message_id,
          u.id   AS user_id,
          u.name AS user_name,
          u.email AS user_email,
          u.image AS user_image,
          us.status AS user_status,
          us.custom_status,
          us.status_emoji,
          us.last_seen_at
        FROM conversation_members cm
        JOIN workspace_members wm
          ON cm.workspace_member_id = wm.id
        JOIN users u
          ON wm.user_id = u.id
        LEFT JOIN user_status us
          ON us.user_id = u.id AND us.workspace_id = $2
        WHERE cm.conversation_id = $1 AND cm.left_at IS NULL
        ORDER BY cm.joined_at ASC
      `;
            const { rows: memRows } = await client.query(membersQuery, [conversationId, workspaceId]);
            conversationMembers = memRows.map((m) => ({
                id: m.id,
                conversation_id: m.conversation_id,
                workspace_member_id: m.workspace_member_id,
                joined_at: m.joined_at,
                left_at: m.left_at,
                last_read_message_id: m.last_read_message_id,
                user: {
                    id: m.user_id,
                    name: m.user_name,
                    email: m.user_email,
                    image: m.user_image,
                },
                ...(m.user_status && {
                    status: {
                        status: m.user_status,
                        custom_status: m.custom_status,
                        status_emoji: m.status_emoji,
                        last_seen_at: m.last_seen_at,
                    },
                }),
            }));
        }

        // Total count
        let totalCount = 0;
        if (include_count === 'true') {
            const countQuery = `
        SELECT COUNT(*) AS total
        FROM messages
        WHERE conversation_id = $1 AND deleted_at IS NULL
      `;
            const { rows: cntRows } = await client.query(countQuery, [conversationId]);
            totalCount = parseInt(cntRows[0]?.total || '0', 10);
        }

        return successResponse({
            conversation: {
                id: result.conversation_id,
                workspace_id: result.workspace_id,
                created_at: result.conversation_created_at,
                updated_at: result.conversation_updated_at,
            },
            messages,
            members: conversationMembers,
            pagination: { hasMore, nextCursor, totalCount },
            user_conversation_data: {
                member_id: result.user_member_id,
                last_read_message_id: result.user_last_read,
                workspace_member_id: result.user_workspace_member_id,
            },
        });
    } catch (error) {
        console.error('Error fetching conversation data:', error);
        if (error instanceof z.ZodError) {
            return errorResponse(`Validation error: ${error.errors.map((e) => e.message).join(', ')}`, 400);
        }
        return errorResponse('Internal server error', 500);
    } finally {
        if (client) {
            client.release();
        }
    }
};
