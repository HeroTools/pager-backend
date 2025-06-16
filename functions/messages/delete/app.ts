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

        const messageId = event.pathParameters?.id;

        if (!messageId) {
            return errorResponse('Message ID is required', 400);
        }

        // Get message and verify ownership
        const { data: message } = await supabase
            .from('messages')
            .select(
                `
          *,
          members!inner(user_id)
        `,
            )
            .eq('id', messageId)
            .single();

        if (!message) {
            return errorResponse('Message not found', 404);
        }

        const member = await getMember(message.workspace_id, userId);

        if (!member || member.id !== message.member_id) {
            return errorResponse('Can only delete your own messages', 403);
        }

        const { error } = await supabase.from('messages').delete().eq('id', messageId);

        if (error) {
            throw error;
        }

        return successResponse({ messageId });
    } catch (error) {
        console.error('Error deleting message:', error);
        return errorResponse('Internal server error', 500);
    }
};
