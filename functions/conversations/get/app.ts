import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse, errorResponse } from '../../common/utils/response';
import {
  WorkspaceMember,
  ConversationMember,
  Conversation,
  ConversationMemberWithDetails,
  User,
} from '../types';
import { withCors } from '../../common/utils/cors';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const workspaceId = event.pathParameters?.workspaceId;
      if (!workspaceId) {
        return errorResponse('Workspace ID is required', 400);
      }

      const includeHidden = event.queryStringParameters?.include_hidden === 'true';

      const currentMember = await getMember(workspaceId, userId);
      if (!currentMember) {
        return errorResponse('Not a member of this workspace', 403);
      }

      const userMembershipQuery = supabase
        .from('conversation_members')
        .select('conversation_id, is_hidden')
        .eq('workspace_member_id', currentMember.id)
        .is('left_at', null);

      if (!includeHidden) {
        userMembershipQuery.eq('is_hidden', false);
      }

      const { data: userMemberships, error: membershipError } = await userMembershipQuery;

      if (membershipError) {
        throw membershipError;
      }

      if (!userMemberships || userMemberships.length === 0) {
        return successResponse([]);
      }

      const conversationIds = userMemberships.map((m) => m.conversation_id);

      const { data: conversationsData, error: conversationsError } = await supabase
        .from('conversations')
        .select('id, workspace_id, created_at, updated_at')
        .in('id', conversationIds)
        .order('updated_at', { ascending: false });

      if (conversationsError) {
        throw conversationsError;
      }

      if (!conversationsData || conversationsData.length === 0) {
        return successResponse([]);
      }

      const { data: allConversationMembers, error: allMembersError } = await supabase
        .from('conversation_members')
        .select(
          `
                id,
                conversation_id,
                workspace_member_id,
                joined_at,
                left_at,
                is_hidden
              `,
        )
        .in('conversation_id', conversationIds)
        .is('left_at', null); // Only active members

      if (allMembersError) {
        throw allMembersError;
      }

      // Step 4: Get unique workspace member IDs and fetch their data once
      const uniqueWorkspaceMemberIds = [
        ...new Set(allConversationMembers?.map((member) => member.workspace_member_id) || []),
      ];

      const { data: workspaceMembers, error: workspaceMembersError } = await supabase
        .from('workspace_members')
        .select(
          `
              id,
              user_id,
              role
            `,
        )
        .in('id', uniqueWorkspaceMemberIds);

      if (workspaceMembersError) {
        throw workspaceMembersError;
      }

      // Step 5: Get unique user IDs and fetch user data once
      const uniqueUserIds = [...new Set(workspaceMembers?.map((member) => member.user_id) || [])];

      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, name, image')
        .in('id', uniqueUserIds);

      if (usersError) {
        throw usersError;
      }

      // Step 6: Create lookup maps for efficient data access
      const usersMap = new Map<string, User>();
      users?.forEach((user) => {
        usersMap.set(user.id, user);
      });

      const workspaceMembersMap = new Map<string, WorkspaceMember>();
      workspaceMembers?.forEach((member) => {
        workspaceMembersMap.set(member.id, member);
      });

      const conversationMembersMap = new Map<string, ConversationMember[]>();
      allConversationMembers?.forEach((member) => {
        if (!conversationMembersMap.has(member.conversation_id)) {
          conversationMembersMap.set(member.conversation_id, []);
        }
        conversationMembersMap.get(member.conversation_id)?.push(member);
      });

      // Step 7: Build the final response
      const conversations: Conversation[] = conversationsData.map((conv) => {
        const conversationMembers = conversationMembersMap.get(conv.id) || [];

        const membersWithDetails: ConversationMemberWithDetails[] = conversationMembers.map(
          (member) => {
            const workspaceMember = workspaceMembersMap.get(member.workspace_member_id);
            const user = workspaceMember ? usersMap.get(workspaceMember.user_id) : null;

            return {
              id: member.id,
              joined_at: member.joined_at,
              left_at: member.left_at,
              is_hidden: member.is_hidden,
              workspace_member: {
                id: workspaceMember?.id || '',
                role: workspaceMember?.role || '',
                user: user || { id: '', name: 'Unknown User', image: null },
              },
            };
          },
        );

        const otherMembers = membersWithDetails.filter(
          (member) => member.workspace_member.user.id !== userId,
        );

        return {
          id: conv.id,
          workspace_id: conv.workspace_id,
          created_at: conv.created_at,
          updated_at: conv.updated_at,
          members: membersWithDetails,
          member_count: membersWithDetails.length,
          other_members: otherMembers,
          is_group_conversation: membersWithDetails.length > 2,
        };
      });

      return successResponse(conversations);
    } catch (error) {
      console.error('Error getting conversations:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
