import { LambdaClient } from '@aws-sdk/client-lambda';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { invokeLambdaFunction } from '../../common/helpers/invoke-lambda';
import { withCors } from '../../common/utils/cors';
import dbPool from '../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../common/utils/response';
import { broadcastMessage } from '../helpers/broadcasting';
import { processMentions } from '../helpers/process-mentions';
import { deltaToMarkdown, deltaToPlainText } from '../helpers/quill-delta-converters';
import { CompleteMessage } from '../types';

const SendMessageSchema = z
  .object({
    body: z.string().optional(),
    plain_text: z.string().optional(),
    attachment_ids: z.array(z.string().uuid()).max(10).default([]),
    parent_message_id: z.string().uuid().optional(),
    thread_id: z.string().uuid().optional(),
    message_type: z.enum(['direct', 'thread', 'system', 'bot']).default('direct'),
  })
  .refine((data) => (data.body && data.body.trim().length > 0) || data.attachment_ids.length > 0, {
    message: 'Either message body or attachments are required',
    path: ['body'],
  });

const PathParamsSchema = z
  .object({
    workspaceId: z.string().uuid('workspaceId is required'),
    channelId: z.string().uuid().optional(),
    conversationId: z.string().uuid().optional(),
  })
  .refine((data) => data.channelId || data.conversationId, {
    message: 'Either channelId or conversationId is required',
  });

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-2' });

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client: PoolClient | null = null;

    try {
      const pathParamsResult = PathParamsSchema.safeParse(event.pathParameters);
      if (!pathParamsResult.success) {
        return errorResponse(
          `Invalid parameters: ${pathParamsResult.error.errors.map((e) => e.message).join(', ')}`,
          400,
        );
      }
      const { workspaceId, channelId, conversationId } = pathParamsResult.data;

      const requestBodyResult = SendMessageSchema.safeParse(
        event.body ? JSON.parse(event.body) : {},
      );
      if (!requestBodyResult.success) {
        console.log(requestBodyResult.error);
        return errorResponse(
          `Invalid request: ${requestBodyResult.error.errors.map((e) => e.message).join(', ')}`,
          400,
        );
      }
      const { body, attachment_ids, parent_message_id, thread_id, message_type } =
        requestBodyResult.data;

      let deltaOps = null;
      let messageText = '';

      if (body) {
        try {
          const parsed = JSON.parse(body);
          deltaOps = parsed.ops;
          messageText = requestBodyResult.data.plain_text || deltaToMarkdown(deltaOps);
        } catch (error) {
          return errorResponse('Invalid message format', 400);
        }
      } else if (requestBodyResult.data.plain_text) {
        messageText = requestBodyResult.data.plain_text;
      }

      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
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
        return errorResponse('Not a member of this workspace', 403);
      }

      const workspaceMember = memberRows[0];

      let accessQuery: string;
      let accessParams: any[];
      let conversationMembers: any[] = [];

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
              SELECT workspace_member_id
              FROM conversation_members cm
              WHERE cm.conversation_id = $1 AND cm.left_at IS NULL
          `;
        accessParams = [conversationId];
      } else {
        await client.query('ROLLBACK');
        return errorResponse('Either channel ID or conversation ID is required', 400);
      }

      const { rows: accessRows } = await client.query(accessQuery, accessParams);

      if (conversationId) {
        conversationMembers = accessRows;
        const hasAccess = conversationMembers.some(
          (member) => member.workspace_member_id === workspaceMember.id,
        );
        if (!hasAccess) {
          await client.query('ROLLBACK');
          return errorResponse('Access denied', 403);
        }
      } else {
        if (accessRows.length === 0) {
          await client.query('ROLLBACK');
          return errorResponse('Access denied', 403);
        }
      }

      if (attachment_ids.length > 0) {
        const attachmentQuery = `
              SELECT id FROM uploaded_files
              WHERE id = ANY($1) AND uploaded_by = $2 AND workspace_id = $3 AND status = 'uploaded'
          `;
        const { rows: attachmentRows } = await client.query(attachmentQuery, [
          attachment_ids,
          userId,
          workspaceId,
        ]);

        if (attachmentRows.length !== attachment_ids.length) {
          await client.query('ROLLBACK');
          return errorResponse('One or more attachments are invalid', 400);
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
          return errorResponse('Parent message not found', 404);
        }

        const parentMessage = parentRows[0];

        if (channelId && parentMessage.channel_id !== channelId) {
          await client.query('ROLLBACK');
          return errorResponse('Parent message is not in this channel', 400);
        }
        if (conversationId && parentMessage.conversation_id !== conversationId) {
          await client.query('ROLLBACK');
          return errorResponse('Parent message is not in this conversation', 400);
        }

        finalThreadId = parentMessage.thread_id || parent_message_id;
      }

      const messageId = crypto.randomUUID();

      const insertMessageQuery = `
          INSERT INTO messages (
              id, body, text, workspace_member_id, workspace_id, channel_id,
              conversation_id, parent_message_id, thread_id, message_type, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
          RETURNING id, created_at
      `;

      const { rows: messageRows } = await client.query(insertMessageQuery, [
        messageId,
        body?.trim() || '',
        messageText,
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
        return errorResponse('Failed to create message', 500);
      }

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
              m.id, m.body, m.text, m.workspace_member_id, m.workspace_id, m.channel_id,
              m.conversation_id, m.parent_message_id, m.thread_id, m.message_type,
              m.created_at, m.updated_at, m.edited_at, m.deleted_at,
              u.id as user_id, u.name as user_name, u.email as user_email, u.image as user_image,
              COALESCE(
                  json_agg(
                      json_build_object(
                          'id', uf.id,
                          'original_filename', uf.original_filename,
                          'content_type', uf.content_type,
                          'size_bytes', uf.size_bytes,
                          'order_index', ma.order_index,
                          'storage_url', CONCAT(
                            $2::text,
                            '/storage/v1/object/files/',
                            uf.s3_key
                          )
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

      const { rows: completeRows } = await client.query(completeMessageQuery, [
        messageId,
        process.env.SUPABASE_URL,
      ]);

      if (completeRows.length === 0) {
        await client.query('ROLLBACK');
        return errorResponse('Failed to fetch created message', 500);
      }

      const completeMessage: CompleteMessage = completeRows[0];
      let mentionedWorkspaceMemberIds: string[] = await processMentions(
        client,
        messageId,
        workspaceId,
        deltaOps,
      );

      await client.query('COMMIT');

      const transformedMessage = {
        id: completeMessage.id,
        body: completeMessage.body,
        text: completeMessage.text,
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
        messageText: requestBodyResult.data.plain_text || deltaToPlainText(deltaOps),
        parentMessageId: completeMessage.parent_message_id || undefined,
        threadId: completeMessage.thread_id || undefined,
        senderName: completeMessage.user_name,
        mentionedWorkspaceMemberIds: mentionedWorkspaceMemberIds,
      };

      console.log('notificationPayload:', notificationPayload);

      let isSelfConversation = false;
      if (conversationId) {
        isSelfConversation =
          conversationMembers.length === 1 &&
          conversationMembers[0].workspace_member_id === workspaceMember.id;
      }

      if (!isSelfConversation) {
        await Promise.all([
          broadcastMessage(transformedMessage, channelId, conversationId),
          invokeLambdaFunction(
            process.env.NOTIFICATION_SERVICE_FUNCTION_ARN as string,
            notificationPayload,
            lambdaClient,
          ),
        ]);
      } else {
        console.log('Self-conversation detected, skipping broadcast and notifications');
      }

      return successResponse(transformedMessage, 201);
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
        );
      }

      if (error instanceof SyntaxError) {
        return errorResponse('Invalid JSON in request body', 400);
      }

      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.error('Error releasing database connection:', releaseError);
        }
      }
    }
  },
);
