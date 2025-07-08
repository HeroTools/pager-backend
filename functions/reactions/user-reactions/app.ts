import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse, errorResponse } from '../../common/utils/response';
import { getMember } from '../../common/helpers/get-member';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = await getUserIdFromToken(event.headers.Authorization);

    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const workspaceId = event.queryStringParameters?.workspaceId;

    if (!workspaceId) {
      return errorResponse('Workspace ID is required', 400);
    }

    // Verify user is a member of the workspace
    const member = await getMember(workspaceId, userId);

    if (!member) {
      return errorResponse('Not a member of this workspace', 403);
    }

    // Get user's reactions in this workspace
    const { data: reactions, error } = await supabase
      .from('reactions')
      .select(
        `
          *,
          messages!inner(
            id,
            body,
            workspace_id,
            channel_id,
            conversation_id
          )
        `,
      )
      .eq('member_id', member.id)
      .eq('messages.workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return successResponse(reactions || []);
  } catch (error) {
    console.error('Error getting user reactions:', error);
    return errorResponse('Internal server error', 500);
  }
};
