import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { supabase } from './utils/supabase-client';
import { errorResponse, successResponse } from './utils/response';
import { getMember } from './helpers/get-member';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const { body, image, workspaceId, channelId, conversationId, parentMessageId } = JSON.parse(event.body || '{}');

        if (!body || !workspaceId) {
            return errorResponse('Body and workspaceId are required', 400);
        }

        const member = await getMember(workspaceId, userId);

        if (!member) {
            return errorResponse('Not a member of this workspace', 403);
        }

        let _conversationId = conversationId;

        // Handle thread replies in conversations
        if (!conversationId && !channelId && parentMessageId) {
            const { data: parentMessage } = await supabase
                .from('messages')
                .select('conversation_id')
                .eq('id', parentMessageId)
                .single();

            if (!parentMessage) {
                return errorResponse('Parent message not found', 404);
            }

            _conversationId = parentMessage.conversation_id;
        }

        const { data: message, error } = await supabase
            .from('messages')
            .insert({
                member_id: member.id,
                body,
                image,
                channel_id: channelId,
                workspace_id: workspaceId,
                parent_message_id: parentMessageId,
                conversation_id: _conversationId,
            })
            .select()
            .single();

        if (error) {
            throw error;
        }

        return successResponse({ messageId: message.id });
    } catch (error) {
        console.error('Error creating message:', error);
        return errorResponse('Internal server error', 500);
    }
};
