import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { successResponse, errorResponse } from '../../common/utils/response';
import { supabase } from '../../common/utils/supabase-client';
import { withCors } from '../../common/utils/cors';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);

      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const memberId = event.pathParameters?.memberId;
      const workspaceId = event.pathParameters?.workspaceId;

      if (!memberId || !workspaceId) {
        return errorResponse('Member ID and workspace ID are required', 400);
      }

      // Get the member to remove
      const { data: memberToRemove, error: memberError } = await supabase
        .from('workspace_members')
        .select('*')
        .eq('id', memberId)
        .eq('workspace_id', workspaceId)
        .single();

      if (memberError || !memberToRemove) {
        return errorResponse('Member not found', 404);
      }

      // Get current member
      const currentMember = await getMember(workspaceId, userId);

      if (!currentMember) {
        return errorResponse('Not a member of this workspace', 403);
      }

      // Business logic checks
      if (memberToRemove.role === 'admin') {
        return errorResponse('Admin cannot be removed', 400);
      }

      if (currentMember.id === memberId && currentMember.role === 'admin') {
        return errorResponse('Cannot remove yourself if you are an admin', 400);
      }

      // Only admins can remove other members, or members can remove themselves
      if (currentMember.role !== 'admin' && currentMember.id !== memberId) {
        return errorResponse('Admin access required', 403);
      }

      // Start a transaction to delete related data
      const { error: deleteError } = await supabase.rpc('remove_member_cascade', {
        member_id_param: memberId,
      });

      if (deleteError) {
        // If the stored procedure doesn't exist, fall back to manual deletion
        console.log('Stored procedure not found, using manual deletion');

        // Delete related data manually
        await Promise.all([
          // Delete messages by this member
          supabase.from('messages').delete().eq('member_id', memberId),

          // Delete reactions by this member
          supabase.from('reactions').delete().eq('member_id', memberId),

          // Delete conversations where this member is involved
          supabase
            .from('conversations')
            .delete()
            .or(`member_one_id.eq.${memberId},member_two_id.eq.${memberId}`),
        ]);

        // Delete the member
        const { error: finalDeleteError } = await supabase
          .from('workspace_members')
          .delete()
          .eq('id', memberId);

        if (finalDeleteError) {
          throw finalDeleteError;
        }
      }

      return successResponse({ memberId });
    } catch (error) {
      console.error('Error removing member:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
