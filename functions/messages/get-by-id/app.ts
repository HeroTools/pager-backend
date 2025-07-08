import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { supabase } from '../../common/utils/supabase-client';
import { errorResponse, successResponse } from '../../common/utils/response';
import { populateReactions } from '../helpers/populate-reactions';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = await getUserIdFromToken(event.headers.Authorization);

    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const messageId = event.pathParameters?.messageId;

    if (!messageId) {
      return errorResponse('Message ID is required', 400);
    }

    const { data: message, error } = await supabase
      .from('messages')
      .select(
        `
          *,
          members!inner(
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
      .eq('id', messageId)
      .single();

    if (error || !message) {
      return errorResponse('Message not found', 404);
    }

    // Check if user is a member of the workspace
    const currentMember = await getMember(message.workspace_id, userId);

    if (!currentMember) {
      return errorResponse('Not a member of this workspace', 403);
    }

    const reactions = await populateReactions(message.id);

    return successResponse({
      ...message,
      member: message.members,
      user: message.members?.users,
      reactions,
    });
  } catch (error) {
    console.error('Error getting message by ID:', error);
    return errorResponse('Internal server error', 500);
  }
};
