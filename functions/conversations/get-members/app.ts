import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import { errorResponse, successResponse } from '../../../common/utils/response';
import { supabase } from '../../../common/utils/supabase-client';

interface ConversationMember {
  id: string;
  workspace_member_id: string;
  joined_at: string;
  left_at: string;
  last_read_message_id: string;
  is_hidden: boolean;
  conversation_id: string;
}

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

      const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationId)
        .single();
      if (conversationError || !conversation) {
        return errorResponse('Conversation not found', 404);
      }

      const { data: conversationMembers, error: membersError } = await supabase
        .from('conversation_members')
        .select(
          `
                id,
                workspace_member_id,
                joined_at,
                left_at,
                last_read_message_id,
                is_hidden,
                conversation_id
            `,
        )
        .eq('conversation_id', conversationId);

      if (membersError) {
        console.error('Supabase error fetching conversation members:', membersError);
        return errorResponse(
          'Failed to fetch conversation members',
          500,
          {},
          {
            details: membersError.message || membersError,
          },
        );
      }

      const members = (conversationMembers || []).map((cm: ConversationMember) => ({
        conversation_member_id: cm.id,
        workspace_member_id: cm.workspace_member_id,
        joined_at: cm.joined_at,
        left_at: cm.left_at,
        last_read_message_id: cm.last_read_message_id,
        is_hidden: cm.is_hidden,
        conversation_id: cm.conversation_id,
      }));
      return successResponse(members, 200);
    } catch (error) {
      console.error('Error getting conversation members:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
