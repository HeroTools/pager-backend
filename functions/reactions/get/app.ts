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

    const messageId = event.queryStringParameters?.messageId;

    if (!messageId) {
      return errorResponse('Message ID is required', 400);
    }

    // Get message to verify access
    const { data: message, error: messageError } = await supabase
      .from('messages')
      .select('workspace_id')
      .eq('id', messageId)
      .single();

    if (messageError || !message) {
      return errorResponse('Message not found', 404);
    }

    // Verify user is a member of the workspace
    const member = await getMember(message.workspace_id, userId);

    if (!member) {
      return errorResponse('Not a member of this workspace', 403);
    }

    // Get all reactions for the message with member and user data
    const { data: reactions, error } = await supabase
      .from('reactions')
      .select(
        `
          *,
          members!inner(
            id,
            users!inner(
              id,
              name,
              image
            )
          )
        `,
      )
      .eq('message_id', messageId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }

    // Group reactions by value and count them
    const reactionCounts = (reactions || []).reduce((acc: any[], reaction) => {
      const existing = acc.find((r) => r.value === reaction.value);

      if (existing) {
        existing.count += 1;
        existing.memberIds.push(reaction.member_id);
        existing.users.push(reaction.members.users);
      } else {
        acc.push({
          value: reaction.value,
          count: 1,
          memberIds: [reaction.member_id],
          users: [reaction.members.users],
        });
      }

      return acc;
    }, []);

    return successResponse(reactionCounts);
  } catch (error) {
    console.error('Error getting reactions:', error);
    return errorResponse('Internal server error', 500);
  }
};
