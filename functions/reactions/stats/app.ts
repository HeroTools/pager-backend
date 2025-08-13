import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import { errorResponse, successResponse } from '../../../common/utils/response';
import { supabase } from '../../../common/utils/supabase-client';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);

      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const messageId = event.pathParameters?.messageId;

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

      // Get reaction statistics
      const { data: stats, error } = await supabase.rpc('get_reaction_stats', {
        message_id_param: messageId,
      });

      if (error) {
        // Fallback to manual aggregation if stored procedure doesn't exist
        const { data: reactions } = await supabase
          .from('reactions')
          .select('value, member_id')
          .eq('message_id', messageId);

        const reactionStats = (reactions || []).reduce((acc: any, reaction) => {
          if (!acc[reaction.value]) {
            acc[reaction.value] = {
              value: reaction.value,
              count: 0,
              memberIds: [],
            };
          }
          acc[reaction.value].count += 1;
          acc[reaction.value].memberIds.push(reaction.member_id);
          return acc;
        }, {});

        const totalReactions = Object.values(reactionStats).reduce(
          (sum: number, stat: any) => sum + stat.count,
          0,
        );

        return successResponse({
          reactions: Object.values(reactionStats),
          totalCount: totalReactions,
          userReacted: Object.values(reactionStats).some((stat: any) =>
            stat.memberIds.includes(member.id),
          ),
        });
      }

      return successResponse(stats || []);
    } catch (error) {
      console.error('Error getting reaction stats:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
