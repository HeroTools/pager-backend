import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import dbPool from './utils/create-db-pool';
import { getUserIdFromToken } from './helpers/auth';
import { successResponse, errorResponse } from './utils/response';
import { ConversationData, MessageWithUser, ConversationMemberWithUser } from './types';

// Validation schemas
const PathParamsSchema = z.object({
    id: z.string().uuid(),
    workspaceId: z.string().uuid(),
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
        // Validate parameters
        const pathParams = PathParamsSchema.parse(event.pathParameters);
        const queryParams = QueryParamsSchema.parse(event.queryStringParameters || {});

        const { id: conversationId, workspaceId } = pathParams;
        const { limit, cursor, before, include_members, include_reactions, include_attachments, include_count } =
            queryParams;

        const userId = await getUserIdFromToken(event.headers.Authorization);
        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        client = await dbPool.connect();

        // SINGLE MEGA-QUERY: Get everything in one go (mimicking the channel pattern)
        const mainQuery = `
            WITH cursor_timestamp AS (
                SELECT created_at 
                FROM messages 
                WHERE id = $3
            ),
            conversation_access AS (
                -- Check if user has access to conversation
                SELECT 
                    c.id, c.workspace_id, c.created_at, c.updated_at,
                    cm.id as member_id,
                    cm.last_read_message_id,
                    wm.id as workspace_member_id,
                    CASE WHEN cm.id IS NOT NULL THEN true ELSE false END as is_member
                FROM conversations c
                LEFT JOIN workspace_members wm ON wm.workspace_id = c.workspace_id 
                    AND wm.user_id = $2 AND wm.is_deactivated IS false
                LEFT JOIN conversation_members cm ON cm.conversation_id = c.id 
                    AND cm.workspace_member_id = wm.id AND cm.left_at IS NULL
                WHERE c.id = $1 AND c.workspace_id = $4
            ),
            filtered_messages AS (
                SELECT m.*
                FROM messages m, conversation_access ca
                WHERE m.conversation_id = $1 
                    AND m.deleted_at IS NULL
                    AND ($3::uuid IS NULL OR m.created_at < (SELECT created_at FROM cursor_timestamp))
                    AND ($5::timestamp IS NULL OR m.created_at < $5::timestamp)
                ORDER BY m.created_at DESC
                LIMIT $6 + 1
            ),
            message_reactions AS (
                SELECT 
                    fm.id as message_id,
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
                FROM filtered_messages fm
                LEFT JOIN reactions r ON r.message_id = fm.id AND $7 = 'true'
                LEFT JOIN workspace_members rwm ON r.workspace_member_id = rwm.id AND $7 = 'true'
                LEFT JOIN users ru ON rwm.user_id = ru.id AND $7 = 'true'
                GROUP BY fm.id
            ),
            message_attachments AS (
                SELECT 
                    fm.id as message_id,
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
                FROM filtered_messages fm
                LEFT JOIN message_attachments ma ON ma.message_id = fm.id AND $8 = 'true'
                LEFT JOIN uploaded_files uf ON ma.uploaded_file_id = uf.id AND $8 = 'true'
                GROUP BY fm.id
            ),
            enriched_messages AS (
                SELECT 
                    fm.*,
                    u.id as user_id,
                    u.name as user_name,
                    u.email as user_email,
                    u.image as user_image,
                    us.status as user_status,
                    us.custom_status,
                    us.status_emoji,
                    us.last_seen_at,
                    mr.reactions_data,
                    ma.attachments_data
                FROM filtered_messages fm
                JOIN workspace_members wm ON fm.workspace_member_id = wm.id
                JOIN users u ON wm.user_id = u.id
                LEFT JOIN user_status us ON us.user_id = u.id AND us.workspace_id = $4
                LEFT JOIN message_reactions mr ON mr.message_id = fm.id
                LEFT JOIN message_attachments ma ON ma.message_id = fm.id
                ORDER BY fm.created_at DESC
            )
            SELECT 
                ca.id as conversation_id,
                ca.workspace_id,
                ca.created_at as conversation_created_at,
                ca.updated_at as conversation_updated_at,
                ca.member_id as user_member_id,
                ca.last_read_message_id as user_last_read,
                ca.workspace_member_id as user_workspace_member_id,
                ca.is_member,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', em.id,
                            'body', em.body,
                            'workspace_member_id', em.workspace_member_id,
                            'workspace_id', em.workspace_id,
                            'channel_id', em.channel_id,
                            'conversation_id', em.conversation_id,
                            'parent_message_id', em.parent_message_id,
                            'thread_id', em.thread_id,
                            'message_type', em.message_type,
                            'created_at', em.created_at,
                            'updated_at', em.updated_at,
                            'edited_at', em.edited_at,
                            'deleted_at', em.deleted_at,
                            'blocks', em.blocks,
                            'metadata', em.metadata,
                            'user', json_build_object(
                                'id', em.user_id,
                                'name', em.user_name,
                                'email', em.user_email,
                                'image', em.user_image,
                                'status', em.user_status,
                                'custom_status', em.custom_status,
                                'status_emoji', em.status_emoji,
                                'last_seen_at', em.last_seen_at
                            ),
                            'reactions', em.reactions_data,
                            'attachments', em.attachments_data
                        ) ORDER BY em.created_at DESC
                    ) FILTER (WHERE em.id IS NOT NULL),
                    '[]'::json
                ) as messages_data
            FROM conversation_access ca
            LEFT JOIN enriched_messages em ON true
            GROUP BY ca.id, ca.workspace_id, ca.created_at, ca.updated_at, 
                     ca.member_id, ca.last_read_message_id, ca.workspace_member_id, ca.is_member
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

        // Check if user is actually a member
        if (!result.is_member) {
            return errorResponse('Access denied', 403);
        }

        // Process messages and pagination
        const rawMessages = result.messages_data || [];
        const hasMore = rawMessages.length > limit;
        const messages = hasMore ? rawMessages.slice(0, limit) : rawMessages;
        const nextCursor = hasMore && messages.length > 0 ? messages[messages.length - 1].id : null;

        // Process reactions - group by emoji
        const processedMessages = messages.map((message: any) => {
            const reactionsMap: Record<string, any> = {};

            if (message.reactions && Array.isArray(message.reactions)) {
                message.reactions.forEach((reaction: any) => {
                    if (!reactionsMap[reaction.value]) {
                        reactionsMap[reaction.value] = {
                            id: `${message.id}_${reaction.value}`,
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
                ...message,
                reactions: Object.values(reactionsMap),
            };
        });

        // Get conversation members if requested
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
                    u.id as user_id,
                    u.name as user_name,
                    u.email as user_email,
                    u.image as user_image,
                    us.status as user_status,
                    us.custom_status,
                    us.status_emoji,
                    us.last_seen_at
                FROM conversation_members cm
                JOIN workspace_members wm ON cm.workspace_member_id = wm.id
                JOIN users u ON wm.user_id = u.id
                LEFT JOIN user_status us ON us.user_id = u.id AND us.workspace_id = $2
                WHERE cm.conversation_id = $1 AND cm.left_at IS NULL
                ORDER BY cm.joined_at ASC
            `;

            const { rows: memberRows } = await client.query(membersQuery, [conversationId, workspaceId]);

            conversationMembers = memberRows.map((member) => ({
                id: member.id,
                conversation_id: member.conversation_id,
                workspace_member_id: member.workspace_member_id,
                joined_at: member.joined_at,
                left_at: member.left_at,
                last_read_message_id: member.last_read_message_id,
                user: {
                    id: member.user_id,
                    name: member.user_name,
                    email: member.user_email,
                    image: member.user_image,
                },
                ...(member.user_status && {
                    status: {
                        status: member.user_status,
                        custom_status: member.custom_status,
                        status_emoji: member.status_emoji,
                        last_seen_at: member.last_seen_at,
                    },
                }),
            }));
        }

        // Get total count if requested
        let totalCount = 0;

        if (include_count === 'true') {
            const countQuery = `
                SELECT COUNT(*) as total
                FROM messages 
                WHERE conversation_id = $1 AND deleted_at IS NULL
            `;
            const { rows: countRows } = await client.query(countQuery, [conversationId]);
            totalCount = parseInt(countRows[0]?.total || '0');
        }

        const responseData: ConversationData = {
            conversation: {
                id: result.conversation_id,
                workspace_id: result.workspace_id,
                created_at: result.conversation_created_at,
                updated_at: result.conversation_updated_at,
            },
            messages: processedMessages as MessageWithUser[],
            members: conversationMembers,
            pagination: {
                hasMore,
                nextCursor,
                totalCount,
            },
            user_conversation_data: {
                member_id: result.user_member_id,
                last_read_message_id: result.user_last_read,
                workspace_member_id: result.user_workspace_member_id,
            },
        };

        return successResponse(responseData);
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
