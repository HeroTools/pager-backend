import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { withCors } from '../../common/utils/cors';
import dbPool from '../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../common/utils/response';

const PathParamsSchema = z.object({
  conversationId: z.string().uuid('conversationId is required'),
  workspaceId: z.string().uuid('workspaceId is required'),
  agentId: z.string().uuid('agentId is required'),
});

const QueryParamsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
  before: z.string().datetime().optional(),
  include_reactions: z.enum(['true', 'false']).default('true'),
  include_attachments: z.enum(['true', 'false']).default('true'),
  include_count: z.enum(['true', 'false']).default('false'),
});

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client: PoolClient | null = null;
    try {
      // Parse and validate
      const pathParams = PathParamsSchema.parse(event.pathParameters);
      const queryParams = QueryParamsSchema.parse(event.queryStringParameters || {});
      const { conversationId, workspaceId, agentId } = pathParams;
      const { limit, cursor, before, include_reactions, include_attachments, include_count } =
        queryParams;

      // Auth
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      client = await dbPool.connect();

      // Verify agent exists in workspace
      const agentCheckQuery = `
        SELECT id, name, avatar_url, is_active
        FROM agents
        WHERE id = $1 AND workspace_id = $2
      `;
      const agentResult = await client.query(agentCheckQuery, [agentId, workspaceId]);
      if (agentResult.rows.length === 0) {
        return errorResponse('Agent not found in this workspace', 404);
      }
      const agent = agentResult.rows[0];

      // Main query - simplified without profile fetching
      const mainQuery = `
        WITH cursor_timestamp AS (
          SELECT created_at
          FROM messages
          WHERE id = $3
        ),
        conversation_access AS (
          SELECT
            c.id, c.workspace_id, c.created_at, c.updated_at, c.title,
            user_cm.id AS user_member_id,
            user_cm.last_read_message_id,
            wm.id AS workspace_member_id,
            agent_cm.id AS agent_member_id,
            CASE WHEN user_cm.id IS NOT NULL AND agent_cm.id IS NOT NULL THEN true ELSE false END AS is_member
          FROM conversations c
          LEFT JOIN workspace_members wm
            ON wm.workspace_id = c.workspace_id
            AND wm.user_id = $2 AND wm.is_deactivated IS false
          LEFT JOIN conversation_members user_cm
            ON user_cm.conversation_id = c.id
            AND user_cm.workspace_member_id = wm.id
            AND user_cm.left_at IS NULL
          LEFT JOIN conversation_members agent_cm
            ON agent_cm.conversation_id = c.id
            AND agent_cm.ai_agent_id = $4
            AND agent_cm.left_at IS NULL
          WHERE c.id = $1 AND c.workspace_id = $5
        ),
        filtered_messages AS (
          SELECT m.*
          FROM messages m, conversation_access ca
          WHERE
            m.conversation_id = $1
            AND m.deleted_at IS NULL
            AND m.parent_message_id IS NULL
            AND ($3::uuid IS NULL OR m.created_at < (SELECT created_at FROM cursor_timestamp))
            AND ($6::timestamp IS NULL OR m.created_at < $6::timestamp)
          ORDER BY m.created_at DESC
          LIMIT $7 + 1
        ),
        message_reactions AS (
          SELECT
            fm.id AS message_id,
            CASE WHEN $8 = 'true' THEN
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
          LEFT JOIN reactions r ON r.message_id = fm.id AND $8 = 'true'
          LEFT JOIN workspace_members rwm ON r.workspace_member_id = rwm.id AND $8 = 'true'
          LEFT JOIN users ru ON rwm.user_id = ru.id AND $8 = 'true'
          GROUP BY fm.id
        ),
        message_attachments AS (
          SELECT
            fm.id AS message_id,
            CASE WHEN $9 = 'true' THEN
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
          LEFT JOIN message_attachments ma ON ma.message_id = fm.id AND $9 = 'true'
          LEFT JOIN uploaded_files uf ON ma.uploaded_file_id = uf.id AND $9 = 'true'
          GROUP BY fm.id
        ),
        enriched_messages AS (
          SELECT
            fm.*,
            mr.reactions_data,
            ma.attachments_data
          FROM filtered_messages fm
          LEFT JOIN message_reactions mr ON mr.message_id = fm.id
          LEFT JOIN message_attachments ma ON ma.message_id = fm.id
          ORDER BY fm.created_at DESC
        )
        SELECT
          ca.id AS conversation_id,
          ca.workspace_id,
          ca.created_at AS conversation_created_at,
          ca.updated_at AS conversation_updated_at,
          ca.title AS conversation_title,
          ca.user_member_id,
          ca.last_read_message_id AS user_last_read,
          ca.workspace_member_id AS user_workspace_member_id,
          ca.agent_member_id,
          ca.is_member,
          COALESCE(
            json_agg(
              json_build_object(
                'id', em.id,
                'body', em.body,
                'workspace_member_id', em.workspace_member_id,
                'ai_agent_id', em.ai_agent_id,
                'workspace_id', em.workspace_id,
                'channel_id', em.channel_id,
                'conversation_id', em.conversation_id,
                'parent_message_id', em.parent_message_id,
                'thread_id', em.thread_id,
                'message_type', em.message_type,
                'sender_type', em.sender_type,
                'created_at', em.created_at,
                'updated_at', em.updated_at,
                'edited_at', em.edited_at,
                'deleted_at', em.deleted_at,
                'blocks', em.blocks,
                'metadata', em.metadata,
                'reactions', em.reactions_data,
                'attachments', em.attachments_data
              ) ORDER BY em.created_at DESC
            ) FILTER (WHERE em.id IS NOT NULL),
            '[]'::json
          ) AS messages_data
        FROM conversation_access ca
        LEFT JOIN enriched_messages em ON true
        GROUP BY
          ca.id, ca.workspace_id, ca.created_at, ca.updated_at, ca.title,
          ca.user_member_id, ca.last_read_message_id,
          ca.workspace_member_id, ca.agent_member_id, ca.is_member;
      `;

      const { rows } = await client.query(mainQuery, [
        conversationId, // $1
        userId, // $2
        cursor || null, // $3
        agentId, // $4
        workspaceId, // $5
        before || null, // $6
        limit, // $7
        include_reactions, // $8
        include_attachments, // $9
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

      // Process reactions
      const messages = slice.map((msg: any) => {
        const reactionMap: Record<string, any> = {};
        (msg.reactions || []).forEach((r: any) => {
          if (!reactionMap[r.value]) {
            reactionMap[r.value] = {
              id: `${msg.id}_${r.value}`,
              value: r.value,
              count: 0,
              users: [],
            };
          }
          reactionMap[r.value].count++;
          reactionMap[r.value].users.push({ id: r.user_id, name: r.user_name });
        });
        return { ...msg, reactions: Object.values(reactionMap) };
      });

      // Total count (optional)
      let totalCount = 0;
      if (include_count === 'true') {
        const countQuery = `
          SELECT COUNT(*) AS total
          FROM messages
          WHERE conversation_id = $1 AND deleted_at IS NULL AND parent_message_id IS NULL
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
          title: result.conversation_title,
        },
        agent: {
          id: agent.id,
          name: agent.name,
          avatar_url: agent.avatar_url,
          is_active: agent.is_active,
        },
        messages,
        pagination: { hasMore, nextCursor, totalCount },
        user_conversation_data: {
          member_id: result.user_member_id,
          last_read_message_id: result.user_last_read,
          workspace_member_id: result.user_workspace_member_id,
        },
      });
    } catch (error) {
      console.error('Error fetching agent conversation data:', error);
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
  },
);
