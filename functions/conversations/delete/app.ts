import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse, errorResponse } from '../../common/utils/response';
import { withCors } from '../../common/utils/cors';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);

      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const conversationId = event.pathParameters?.conversationId;

      if (!conversationId) {
        return errorResponse('Conversation ID is required', 400);
      }

      // Get conversation
      const { data: conversation, error: conversationError } = await supabase
        .from('conversations')
        .select('*')
        .eq('id', conversationId)
        .single();

      if (conversationError || !conversation) {
        return errorResponse('Conversation not found', 404);
      }

      // Verify user is a member of the workspace
      const member = await getMember(conversation.workspace_id, userId);

      if (!member) {
        return errorResponse('Not a member of this workspace', 403);
      }

      // Get all conversation members to check if this is a self-conversation
      const { data: conversationMembers, error: conversationMembersError } = await supabase
        .from('conversation_members')
        .select('id, workspace_member_id')
        .eq('conversation_id', conversationId)
        .is('left_at', null);

      if (conversationMembersError || !conversationMembers) {
        return errorResponse('Error fetching conversation members', 500);
      }

      if (conversationMembers.length === 1) {
        return errorResponse('Cannot delete self-conversation', 403);
      }

      // Verify user is part of this conversation
      const userConversationMember = conversationMembers.find(
        (cm) => cm.workspace_member_id === member.id,
      );
      if (!userConversationMember) {
        return errorResponse('Not authorized to delete this conversation', 403);
      }

      // Delete all messages in the conversation first
      const { error: messagesError } = await supabase
        .from('messages')
        .delete()
        .eq('conversation_id', conversationId);

      if (messagesError) {
        console.error('Error deleting conversation messages:', messagesError);
        // Continue with conversation deletion even if message deletion fails
      }

      // Delete conversation members
      const { error: membersError } = await supabase
        .from('conversation_members')
        .delete()
        .eq('conversation_id', conversationId);

      if (membersError) {
        console.error('Error deleting conversation members:', membersError);
      }

      // Delete conversation
      const { error } = await supabase.from('conversations').delete().eq('id', conversationId);

      if (error) {
        throw error;
      }

      return successResponse({ conversation_id: conversationId });
    } catch (error) {
      console.error('Error deleting conversation:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
