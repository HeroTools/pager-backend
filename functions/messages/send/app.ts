import { PoolClient } from 'pg';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import dbPool from './utils/create-db-pool';
import { getUserIdFromToken } from './helpers/auth';
import { errorResponse, setCorsHeaders, successResponse } from './utils/response';
import { broadcastMessage, broadcastTypingStatus } from './helpers/broadcasting';
import { CompleteMessage } from './type';
import { invokeLambdaFunction } from './helpers/invoke-lambda';
import { LambdaClient } from '@aws-sdk/client-lambda';

const SendMessageSchema = z
    .object({
        body: z.string().optional(),
        attachment_ids: z.array(z.string().uuid()).max(10).default([]), // Limit to 10 attachments
        parent_message_id: z.string().uuid().optional(),
        thread_id: z.string().uuid().optional(),
        message_type: z.enum(['direct', 'thread', 'system', 'bot']).default('direct'),
    })
    .refine((data) => (data.body && data.body.trim().length > 0) || data.attachment_ids.length > 0, {
        message: 'Either message body or attachments are required',
        path: ['body'],
    })
    .refine(
        (data) => !data.body || data.body.trim().length <= 4000, // Message length limit
        {
            message: 'Message body cannot exceed 4000 characters',
            path: ['body'],
        },
    );

const PathParamsSchema = z
    .object({
        workspaceId: z.string().uuid(),
        channelId: z.string().uuid().optional(),
        conversationId: z.string().uuid().optional(),
    })
    .refine((data) => data.channelId || data.conversationId, {
        message: 'Either channelId or conversationId is required',
    });

const lambdaClient = new LambdaClient({ region: 'us-east-2' });

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers.Origin || event.headers.origin;
    const corsHeaders = setCorsHeaders(origin, 'POST');

    if (event.httpMethod === 'OPTIONS') {
        return successResponse({ message: 'OK' }, 200, corsHeaders);
    }

    let client: PoolClient | null = null;

    try {
        const pathParamsResult = PathParamsSchema.safeParse(event.pathParameters);
        if (!pathParamsResult.success) {
            return errorResponse(
                `Invalid parameters: ${pathParamsResult.error.errors.map((e) => e.message).join(', ')}`,
                400,
                corsHeaders,
            );
        }
        const { workspaceId, channelId, conversationId } = pathParamsResult.data;

        const requestBodyResult = SendMessageSchema.safeParse(event.body ? JSON.parse(event.body) : {});
        if (!requestBodyResult.success) {
            console.log(requestBodyResult.error);
            return errorResponse(
                `Invalid request: ${requestBodyResult.error.errors.map((e) => e.message).join(', ')}`,
                400,
                corsHeaders,
            );
        }
        const { body, attachment_ids, parent_message_id, thread_id, message_type } = requestBodyResult.data;

        const userId = await getUserIdFromToken(event.headers.Authorization);
        if (!userId) {
            return errorResponse('Unauthorized', 401, corsHeaders);
        }

        client = await dbPool.connect();
        await client.query('BEGIN');

        const workspaceMemberQuery = `
            SELECT wm.id, wm.user_id 
            FROM workspace_members wm 
            WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND wm.is_deactivated IS false
        `;
        const { rows: memberRows } = await client.query(workspaceMemberQuery, [workspaceId, userId]);

        if (memberRows.length === 0) {
            await client.query('ROLLBACK');
            return errorResponse('Not a member of this workspace', 403, corsHeaders);
        }

        const workspaceMember = memberRows[0];

        let accessQuery: string;
        let accessParams: any[];

        if (channelId) {
            accessQuery = `
                SELECT 1 FROM channel_members cm 
                WHERE cm.channel_id = $1 AND cm.workspace_member_id = $2
                UNION
                SELECT 1 FROM channels c 
                WHERE c.id = $1 AND c.channel_type = 'public'
                LIMIT 1
            `;
            accessParams = [channelId, workspaceMember.id];
        } else if (conversationId) {
            accessQuery = `
                SELECT 1 FROM conversation_members cm 
                WHERE cm.conversation_id = $1 AND cm.workspace_member_id = $2 AND cm.left_at IS NULL
            `;
            accessParams = [conversationId, workspaceMember.id];
        } else {
            await client.query('ROLLBACK');
            return errorResponse('Either channel ID or conversation ID is required', 400, corsHeaders);
        }

        const { rows: accessRows } = await client.query(accessQuery, accessParams);
        if (accessRows.length === 0) {
            await client.query('ROLLBACK');
            return errorResponse('Access denied', 403, corsHeaders);
        }

        if (attachment_ids.length > 0) {
            const attachmentQuery = `
                SELECT id FROM uploaded_files 
                WHERE id = ANY($1) AND uploaded_by = $2 AND workspace_id = $3 AND status = 'uploaded'
            `;
            const { rows: attachmentRows } = await client.query(attachmentQuery, [attachment_ids, userId, workspaceId]);

            if (attachmentRows.length !== attachment_ids.length) {
                await client.query('ROLLBACK');
                return errorResponse('One or more attachments are invalid', 400, corsHeaders);
            }
        }

        let finalThreadId = thread_id;
        if (parent_message_id) {
            const parentQuery = `
                SELECT id, thread_id, channel_id, conversation_id 
                FROM messages 
                WHERE id = $1
            `;
            const { rows: parentRows } = await client.query(parentQuery, [parent_message_id]);

            if (parentRows.length === 0) {
                await client.query('ROLLBACK');
                return errorResponse('Parent message not found', 404, corsHeaders);
            }

            const parentMessage = parentRows[0];

            // Verify parent message belongs to same channel/conversation
            if (channelId && parentMessage.channel_id !== channelId) {
                await client.query('ROLLBACK');
                return errorResponse('Parent message is not in this channel', 400, corsHeaders);
            }
            if (conversationId && parentMessage.conversation_id !== conversationId) {
                await client.query('ROLLBACK');
                return errorResponse('Parent message is not in this conversation', 400, corsHeaders);
            }

            finalThreadId = parentMessage.thread_id || parent_message_id;
        }

        // Stop typing notification
        await broadcastTypingStatus(userId, channelId, conversationId, false);

        const messageId = crypto.randomUUID();

        // Insert message
        const insertMessageQuery = `
            INSERT INTO messages (
                id, body, workspace_member_id, workspace_id, channel_id, 
                conversation_id, parent_message_id, thread_id, message_type, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            RETURNING id, created_at
        `;

        const { rows: messageRows } = await client.query(insertMessageQuery, [
            messageId,
            body?.trim() || '',
            workspaceMember.id,
            workspaceId,
            channelId || null,
            conversationId || null,
            parent_message_id || null,
            finalThreadId || null,
            message_type,
        ]);

        if (messageRows.length === 0) {
            await client.query('ROLLBACK');
            return errorResponse('Failed to create message', 500, corsHeaders);
        }

        // Insert message attachments if any
        if (attachment_ids.length > 0) {
            const values: string[] = [];
            const params: any[] = [];
            let paramIndex = 1;

            attachment_ids.forEach((id, index) => {
                values.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2})`);
                params.push(messageId, id, index);
                paramIndex += 3;
            });

            const insertAttachmentsQuery = `
                INSERT INTO message_attachments (message_id, uploaded_file_id, order_index)
                VALUES ${values.join(', ')}
            `;
            await client.query(insertAttachmentsQuery, params);

            const updateStatusQuery = `
                UPDATE uploaded_files 
                SET status = 'attached' 
                WHERE id = ANY($1)
            `;
            await client.query(updateStatusQuery, [attachment_ids]);
        }

        const completeMessageQuery = `
            SELECT 
                m.id, m.body, m.workspace_member_id, m.workspace_id, m.channel_id,
                m.conversation_id, m.parent_message_id, m.thread_id, m.message_type,
                m.created_at, m.updated_at, m.edited_at, m.deleted_at,
                u.id as user_id, u.name as user_name, u.email as user_email, u.image as user_image,
                COALESCE(
                    json_agg(
                        json_build_object(
                            'id', uf.id,
                            'original_filename', uf.original_filename,
                            'public_url', uf.public_url,
                            'content_type', uf.content_type,
                            'size_bytes', uf.size_bytes,
                            'order_index', ma.order_index
                        ) ORDER BY ma.order_index
                    ) FILTER (WHERE uf.id IS NOT NULL),
                    '[]'::json
                ) as attachments
            FROM messages m
            JOIN workspace_members wm ON m.workspace_member_id = wm.id
            JOIN users u ON wm.user_id = u.id
            LEFT JOIN message_attachments ma ON m.id = ma.message_id
            LEFT JOIN uploaded_files uf ON ma.uploaded_file_id = uf.id
            WHERE m.id = $1
            GROUP BY m.id, m.workspace_member_id, m.workspace_id, m.channel_id, 
                     m.conversation_id, m.parent_message_id, m.thread_id, m.message_type,
                     m.created_at, m.updated_at, m.edited_at, m.deleted_at,
                     u.id, u.name, u.email, u.image
        `;

        const { rows: completeRows } = await client.query(completeMessageQuery, [messageId]);

        if (completeRows.length === 0) {
            await client.query('ROLLBACK');
            return errorResponse('Failed to fetch created message', 500, corsHeaders);
        }

        const completeMessage: CompleteMessage = completeRows[0];

        await client.query('COMMIT');

        const transformedMessage = {
            id: completeMessage.id,
            body: completeMessage.body,
            workspace_member_id: completeMessage.workspace_member_id,
            workspace_id: completeMessage.workspace_id,
            channel_id: completeMessage.channel_id,
            conversation_id: completeMessage.conversation_id,
            parent_message_id: completeMessage.parent_message_id,
            thread_id: completeMessage.thread_id,
            message_type: completeMessage.message_type,
            created_at: completeMessage.created_at,
            updated_at: completeMessage.updated_at,
            edited_at: completeMessage.edited_at,
            deleted_at: completeMessage.deleted_at,
            user: {
                id: completeMessage.user_id,
                name: completeMessage.user_name,
                email: completeMessage.user_email,
                image: completeMessage.user_image,
            },
            attachments: Array.isArray(completeMessage.attachments) ? completeMessage.attachments : [],
            reactions: [],
        };

        const notificationPayload = {
            messageId: completeMessage.id,
            senderWorkspaceMemberId: workspaceMember.id,
            workspaceId: workspaceId,
            channelId: channelId || undefined,
            conversationId: conversationId || undefined,
            messageBody: completeMessage.body,
            parentMessageId: completeMessage.parent_message_id || undefined,
            threadId: completeMessage.thread_id || undefined,
            senderName: completeMessage.user_name,
        };

        console.log('notificationPayload:', notificationPayload);

        await Promise.all([
            broadcastMessage(transformedMessage, channelId, conversationId),
            invokeLambdaFunction(
                process.env.NOTIFICATION_SERVICE_FUNCTION_ARN as string,
                notificationPayload,
                lambdaClient,
            ),
        ]);

        console.log(
            `Message sent with ${attachment_ids.length} attachments to ${channelId ? 'channel' : 'conversation'}`,
        );

        return successResponse(transformedMessage, 201, corsHeaders);
    } catch (error) {
        if (client) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('Error during rollback:', rollbackError);
            }
        }

        console.error('Error creating message:', error);

        if (error instanceof z.ZodError) {
            return errorResponse(
                `Validation error: ${error.errors.map((e) => e.message).join(', ')}`,
                400,
                corsHeaders,
            );
        }

        if (error instanceof SyntaxError) {
            return errorResponse('Invalid JSON in request body', 400, corsHeaders);
        }

        return errorResponse('Internal server error', 500, corsHeaders);
    } finally {
        if (client) {
            try {
                client.release();
            } catch (releaseError) {
                console.error('Error releasing database connection:', releaseError);
            }
        }
    }
};
