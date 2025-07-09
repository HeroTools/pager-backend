import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import dbPool from '../../common/utils/create-db-pool';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { successResponse, errorResponse } from '../../common/utils/response';
import { MessageWithUser } from '../../common/types';
import { withCors } from '../../common/utils/cors';

const PathParamsSchema = z.object({
  messageId: z.string().uuid('messageId is required'),
  workspaceId: z.string().uuid('workspaceId is required'),
});

const QueryParamsSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50),
  cursor: z.string().uuid().optional(),
  before: z.string().datetime().optional(),
  include_reactions: z.enum(['true', 'false']).default('true'),
  include_attachments: z.enum(['true', 'false']).default('true'),
  include_count: z.enum(['true', 'false']).default('false'),
  entity_type: z.enum(['channel', 'conversation']),
  entity_id: z.string().uuid(),
});

interface MessageRepliesData {
  replies: MessageWithUser[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    totalCount: number;
  };
}

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client: PoolClient | null = null;

    try {
      const pathParams = PathParamsSchema.parse(event.pathParameters);
      const queryParams = QueryParamsSchema.parse(event.queryStringParameters || {});

      const { messageId, workspaceId } = pathParams;
      const {
        limit,
        cursor,
        before,
        include_reactions,
        include_attachments,
        include_count,
        entity_type,
        entity_id,
      } = queryParams;

      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      client = await dbPool.connect();

      const mainQuery = `
            WITH cursor_timestamp AS (
                SELECT created_at 
                FROM messages 
                WHERE id = $3
            ),
            access_validation AS (
                SELECT CASE 
                    WHEN $9 = 'channel' THEN (
                        SELECT COUNT(*) > 0 
                        FROM channel_members cm
                        JOIN workspace_members wm ON cm.workspace_member_id = wm.id
                        WHERE cm.channel_id = $10
                            AND wm.user_id = $2 
                            AND wm.is_deactivated = false
                            AND cm.left_at IS NULL
                    )
                    WHEN $9 = 'conversation' THEN (
                        SELECT COUNT(*) > 0 
                        FROM conversation_members cm
                        JOIN workspace_members wm ON cm.workspace_member_id = wm.id
                        WHERE cm.conversation_id = $10
                            AND wm.user_id = $2 
                            AND wm.is_deactivated = false
                            AND cm.left_at IS NULL
                    )
                    ELSE false
                END as has_access
            ),
            filtered_replies AS (
                SELECT r.*
                FROM messages r, access_validation av
                WHERE r.parent_message_id = $1 
                    AND r.deleted_at IS NULL
                    AND av.has_access = true
                    AND ($3::uuid IS NULL OR r.created_at < (SELECT created_at FROM cursor_timestamp))
                    AND ($5::timestamp IS NULL OR r.created_at < $5::timestamp)
                ORDER BY r.created_at ASC
                LIMIT $6 + 1
            ),
            reply_reactions AS (
                SELECT 
                    fr.id as message_id,
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
                    END as reactions_data
                FROM filtered_replies fr
                LEFT JOIN reactions r ON r.message_id = fr.id AND $7 = 'true'
                LEFT JOIN workspace_members rwm ON r.workspace_member_id = rwm.id AND $7 = 'true'
                LEFT JOIN users ru ON rwm.user_id = ru.id AND $7 = 'true'
                GROUP BY fr.id
            ),
            reply_attachments AS (
                SELECT 
                    fr.id as message_id,
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
                    END as attachments_data
                FROM filtered_replies fr
                LEFT JOIN message_attachments ma ON ma.message_id = fr.id AND $8 = 'true'
                LEFT JOIN uploaded_files uf ON ma.uploaded_file_id = uf.id AND $8 = 'true'
                GROUP BY fr.id
            ),
            enriched_replies AS (
                SELECT 
                    fr.*,
                    u.id as user_id,
                    u.name as user_name,
                    u.email as user_email,
                    u.image as user_image,
                    us.status as user_status,
                    us.custom_status,
                    us.status_emoji,
                    us.last_seen_at,
                    rr.reactions_data,
                    ra.attachments_data
                FROM filtered_replies fr
                JOIN workspace_members wm ON fr.workspace_member_id = wm.id
                JOIN users u ON wm.user_id = u.id
                LEFT JOIN user_status us ON us.user_id = u.id AND us.workspace_id = $4
                LEFT JOIN reply_reactions rr ON rr.message_id = fr.id
                LEFT JOIN reply_attachments ra ON ra.message_id = fr.id
                ORDER BY fr.created_at ASC
            )
            SELECT 
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', er.id,
                            'body', er.body,
                            'workspace_member_id', er.workspace_member_id,
                            'workspace_id', er.workspace_id,
                            'channel_id', er.channel_id,
                            'conversation_id', er.conversation_id,
                            'parent_message_id', er.parent_message_id,
                            'thread_id', er.thread_id,
                            'message_type', er.message_type,
                            'created_at', er.created_at,
                            'updated_at', er.updated_at,
                            'edited_at', er.edited_at,
                            'deleted_at', er.deleted_at,
                            'blocks', er.blocks,
                            'metadata', er.metadata,
                            'user', json_build_object(
                                'id', er.user_id,
                                'name', er.user_name,
                                'email', er.user_email,
                                'image', er.user_image,
                                'status', er.user_status,
                                'custom_status', er.custom_status,
                                'status_emoji', er.status_emoji,
                                'last_seen_at', er.last_seen_at
                            ),
                            'reactions', er.reactions_data,
                            'attachments', er.attachments_data
                        ) ORDER BY er.created_at ASC
                    ) FILTER (WHERE er.id IS NOT NULL),
                    '[]'::json
                ) as replies_data
            FROM enriched_replies er
        `;

      const { rows } = await client.query(mainQuery, [
        messageId, // $1
        userId, // $2
        cursor || null, // $3
        workspaceId, // $4
        before || null, // $5
        limit, // $6
        include_reactions, // $7
        include_attachments, // $8
        entity_type, // $9
        entity_id, // $10
      ]);

      // If no rows returned, either no access or no replies
      if (rows.length === 0) {
        return errorResponse('Access denied or no replies found', 403);
      }

      const result = rows[0];
      const rawReplies = result.replies_data || [];

      // Process replies and pagination
      const hasMore = rawReplies.length > limit;
      const replies = hasMore ? rawReplies.slice(0, limit) : rawReplies;
      const nextCursor = hasMore && replies.length > 0 ? replies[replies.length - 1].id : null;

      // Process reactions - group by emoji
      const processedReplies = replies.map((reply: any) => {
        const reactionsMap: Record<string, any> = {};

        if (reply.reactions && Array.isArray(reply.reactions)) {
          reply.reactions.forEach((reaction: any) => {
            if (!reactionsMap[reaction.value]) {
              reactionsMap[reaction.value] = {
                id: `${reply.id}_${reaction.value}`,
                value: reaction.value,
                count: 0,
                users: [],
              };
            }
            reactionsMap[reaction.value].count++;
            reactionsMap[reaction.value].users.push({
              id: reaction.user_id,
              name: reaction.user_name,
            });
          });
        }

        return {
          ...reply,
          reactions: Object.values(reactionsMap),
        };
      });

      // Get total count if requested
      let totalCount = 0;

      if (include_count === 'true') {
        const countQuery = `
                WITH access_validation AS (
                    SELECT CASE 
                        WHEN $3 = 'channel' THEN (
                            SELECT COUNT(*) > 0 
                            FROM channel_members cm
                            JOIN workspace_members wm ON cm.workspace_member_id = wm.id
                            WHERE cm.channel_id = $4
                                AND wm.user_id = $2 
                                AND wm.is_deactivated = false
                                AND cm.left_at IS NULL
                        )
                        WHEN $3 = 'conversation' THEN (
                            SELECT COUNT(*) > 0 
                            FROM conversation_members cm
                            JOIN workspace_members wm ON cm.workspace_member_id = wm.id
                            WHERE cm.conversation_id = $4
                                AND wm.user_id = $2 
                                AND wm.is_deactivated = false
                                AND cm.left_at IS NULL
                        )
                        ELSE false
                    END as has_access
                )
                SELECT COUNT(*) as total
                FROM messages m, access_validation av
                WHERE m.parent_message_id = $1 
                    AND m.deleted_at IS NULL
                    AND av.has_access = true
            `;
        const { rows: countRows } = await client.query(countQuery, [
          messageId,
          userId,
          entity_type,
          entity_id,
        ]);
        totalCount = parseInt(countRows[0]?.total || '0');
      }

      const responseData: MessageRepliesData = {
        replies: processedReplies as MessageWithUser[],
        pagination: {
          hasMore,
          nextCursor,
          totalCount,
        },
      };

      return successResponse(responseData);
    } catch (error) {
      console.error('Error fetching message replies:', error);

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
