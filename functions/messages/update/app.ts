import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { getUserIdFromToken } from './helpers/auth';
import { supabase } from './utils/supabase-client';
import { setCorsHeaders, errorResponse, successResponse } from './utils/response';
import { getMember } from './helpers/get-member';
import { deltaToMarkdown } from './helpers/quill-delta-converters';
import { broadcastMessageUpdate } from './helpers/broadcasting';

const PathParamsSchema = z.object({
    workspaceId: z.string().uuid('Invalid workspace ID format'),
    messageId: z.string().uuid('Invalid message ID format'),
});

const RequestBodySchema = z.object({
    body: z.string().min(1, 'Message body is required'),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers.Origin || event.headers.origin;
    const corsHeaders = setCorsHeaders(origin, 'PUT');

    if (event.httpMethod === 'OPTIONS') {
        return successResponse({ message: 'OK' }, 200, corsHeaders);
    }

    try {
        const pathParamsResult = PathParamsSchema.safeParse(event.pathParameters);
        if (!pathParamsResult.success) {
            return errorResponse(
                `Invalid parameters: ${pathParamsResult.error.errors.map((e) => e.message).join(', ')}`,
                400,
                corsHeaders,
            );
        }
        const { workspaceId, messageId } = pathParamsResult.data;

        const requestBodyResult = RequestBodySchema.safeParse(event.body ? JSON.parse(event.body) : {});
        if (!requestBodyResult.success) {
            return errorResponse(
                `Invalid request: ${requestBodyResult.error.errors.map((e) => e.message).join(', ')}`,
                400,
                corsHeaders,
            );
        }
        const { body } = requestBodyResult.data;

        let deltaOps;
        let messageMarkdown;
        try {
            const parsedBody = JSON.parse(body);
            deltaOps = parsedBody.ops;

            if (!Array.isArray(deltaOps)) {
                return errorResponse('Invalid message format: ops must be an array', 400, corsHeaders);
            }

            messageMarkdown = deltaToMarkdown(deltaOps);

            if (messageMarkdown.length > 40000) {
                return errorResponse('Message cannot exceed 40,000 characters', 400, corsHeaders);
            }
        } catch (parseError) {
            return errorResponse('Invalid message format: must be valid Quill delta JSON', 400, corsHeaders);
        }

        const userId = await getUserIdFromToken(event.headers.Authorization);
        if (!userId) {
            return errorResponse('Unauthorized', 401, corsHeaders);
        }
        const member = await getMember(workspaceId, userId);
        if (!member) {
            return errorResponse('Not a member of this workspace', 403, corsHeaders);
        }

        const { data: message, error: messageError } = await supabase
            .from('messages')
            .select(
                `
                *,
                workspace_members!inner(user_id)
            `,
            )
            .eq('id', messageId)
            .eq('workspace_id', workspaceId)
            .is('deleted_at', null)
            .single();

        if (messageError || !message) {
            return errorResponse('Message not found', 404, corsHeaders);
        }

        if (member.id !== message.workspace_member_id) {
            return errorResponse('Can only edit your own messages', 403, corsHeaders);
        }
        const messageAge = Date.now() - new Date(message.created_at).getTime();
        const maxEditAge = 24 * 60 * 60 * 1000;
        if (messageAge > maxEditAge) {
            return errorResponse('Message is too old to edit', 403, corsHeaders);
        }

        const { error: updateError } = await supabase
            .from('messages')
            .update({
                body,
                text: messageMarkdown,
                edited_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            })
            .eq('id', messageId);
        if (updateError) {
            console.error('Database update error:', updateError);
            return errorResponse('Failed to update message', 500, corsHeaders);
        }

        await broadcastMessageUpdate(
            {
                id: messageId,
                body,
                text: messageMarkdown,
                edited_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                parent_message_id: message.parent_message_id,
            },
            workspaceId,
            message.channel_id,
            message.conversation_id,
        );

        return successResponse(
            {
                messageId,
                updatedAt: new Date().toISOString(),
            },
            200,
            corsHeaders,
        );
    } catch (error) {
        console.error('Error updating message:', error);

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
    }
};
