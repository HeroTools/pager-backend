import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse, errorResponse } from '../../common/utils/response';
import { withCors } from '../../common/utils/cors';

// We will be fetching the messaging for the conversation here, in addition to the information that's related to the conversation.
export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);

      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const conversationId = event.pathParameters?.conversationId;
      const workspaceId = event.pathParameters?.workspaceId;

      if (!conversationId || !workspaceId) {
        return errorResponse('Conversation ID and workspace ID are required', 400);
      }

      const workspaceMember = await getMember(workspaceId, userId);

      if (!workspaceMember) {
        return errorResponse('Not a member of this workspace', 403);
      }

      // Check if user is a member of this conversation
      const { data: conversationMember, error: conversationMemberError } = await supabase
        .from('conversation_members')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('workspace_member_id', workspaceMember.id)
        .is('left_at', null) // Only active members
        .single();

      if (conversationMemberError || !conversationMember) {
        return errorResponse('Not a member of this conversation', 403);
      }

      // Get conversation
      const { data: conversation, error } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (error || !conversation) {
        return errorResponse('Conversation not found', 404);
      }

      return successResponse(conversation);
    } catch (error) {
      console.error('Error getting conversation by ID:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
