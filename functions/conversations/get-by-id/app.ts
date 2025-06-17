import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getMember } from './helpers/get-member';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';

// We will be fetching the messaging for the conversation here, in addition to the information that's related to the conversation.

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const conversationId = event.pathParameters?.id;

        if (!conversationId) {
            return errorResponse('Conversation ID is required', 400);
        }

        // Get conversation with member details
        const { data: conversation, error } = await supabase
            .from('conversations')
            .select(
                `
          *,
          member_one:members!conversations_member_one_id_fkey(
            id,
            role,
            users!inner(
              id,
              name,
              image
            )
          ),
          member_two:members!conversations_member_two_id_fkey(
            id,
            role,
            users!inner(
              id,
              name,
              image
            )
          )
        `,
            )
            .eq('id', conversationId)
            .single();

        if (error || !conversation) {
            return errorResponse('Conversation not found', 404);
        }

        // Verify user is a member of the workspace
        const member = await getMember(conversation.workspace_id, userId);

        if (!member) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // Verify user is part of this conversation
        if (member.id !== conversation.member_one_id && member.id !== conversation.member_two_id) {
            return errorResponse('Not authorized to view this conversation', 403);
        }

        return successResponse(conversation);
    } catch (error) {
        console.error('Error getting conversation:', error);
        return errorResponse('Internal server error', 500);
    }
};
