import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { withCors } from '../../common/utils/cors';
import { errorResponse, successResponse } from '../../common/utils/response';
import { supabase } from '../../common/utils/supabase-client';
import { Conversation, ConversationMemberWithDetails } from '../types';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      // 1) Auth & workspace check
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) return errorResponse('Unauthorized', 401);

      const workspaceId = event.pathParameters?.workspaceId;
      if (!workspaceId) return errorResponse('Workspace ID is required', 400);

      const includeHidden = event.queryStringParameters?.include_hidden === 'true';
      const currentMember = await getMember(workspaceId, userId);
      if (!currentMember) return errorResponse('Not a member of this workspace', 403);

      // 2) First, get conversation IDs where the current user is a member
      let userConversationsQuery = supabase
        .from('conversation_members')
        .select('conversation_id, is_hidden')
        .eq('workspace_member_id', currentMember.id)
        .is('left_at', null);

      if (!includeHidden) {
        userConversationsQuery = userConversationsQuery.eq('is_hidden', false);
      }

      const { data: userConversations, error: userConversationsError } =
        await userConversationsQuery;
      if (userConversationsError) throw userConversationsError;
      if (!userConversations || userConversations.length === 0) {
        return successResponse([], 200);
      }

      const conversationIds = userConversations.map((uc) => uc.conversation_id);

      // 3) Now get all conversations with ALL their members
      const { data: rawConversations, error } = await supabase
        .from('conversations')
        .select(
          `
          id,
          workspace_id,
          created_at,
          updated_at,
          conversation_members!inner(
            id,
            workspace_member_id,
            joined_at,
            left_at,
            is_hidden,
            last_read_message_id,
            workspace_members:workspace_member_id (
              id,
              role,
              is_deactivated,
              users:user_id (
                id,
                name,
                image
              )
            )
          )
        `,
        )
        .eq('workspace_id', workspaceId)
        .in('id', conversationIds)
        .is('conversation_members.left_at', null)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      if (!rawConversations || rawConversations.length === 0) {
        return successResponse([], 200);
      }

      // 4) Map to your public `Conversation` DTO
      const conversations: Conversation[] = rawConversations.map((c) => {
        const members: ConversationMemberWithDetails[] = c.conversation_members.map((cm) => ({
          id: cm.id,
          joined_at: cm.joined_at,
          left_at: cm.left_at,
          is_hidden: cm.is_hidden,
          last_read_message_id: cm.last_read_message_id,
          workspace_member: {
            id: cm.workspace_members.id,
            role: cm.workspace_members.role,
            is_deactivated: cm.workspace_members.is_deactivated,
            user: {
              id: cm.workspace_members.users.id,
              name: cm.workspace_members.users.name,
              image: cm.workspace_members.users.image,
            },
          },
        }));

        const other_members = members.filter((m) => m.workspace_member.user.id !== userId);
        const member_count = members.length;

        return {
          id: c.id,
          workspace_id: c.workspace_id,
          created_at: c.created_at,
          updated_at: c.updated_at,
          members,
          member_count,
          other_members,
          is_group_conversation: member_count > 2,
        };
      });

      return successResponse(conversations, 200);
    } catch (err) {
      console.error('Error getting conversations:', err);
      return errorResponse('Internal server error', 500);
    }
  },
);
