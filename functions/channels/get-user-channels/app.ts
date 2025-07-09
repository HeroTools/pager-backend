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

      const workspaceId = event.pathParameters?.workspaceId;
      if (!workspaceId) {
        return errorResponse('Workspace ID is required', 400);
      }

      const member = await getMember(workspaceId, userId);
      if (!member) {
        return errorResponse('Not a member of this workspace', 403);
      }

      const { data: rawChannels, error } = await supabase
        .from('channels')
        .select(
          `
        *,
        channel_members!inner(
          id,
          role,
          joined_at,
          notifications_enabled,
          last_read_message_id
        )
      `,
        )
        .eq('workspace_id', workspaceId)
        .eq('channel_members.workspace_member_id', member.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      const channels = (rawChannels || []).map(({ _channel_members, ...c }) => c);
      return successResponse(channels, 200);
    } catch (err) {
      console.error('Error getting user channels:', err);
      return errorResponse(
        'Internal server error',
        500,
        {},
        {
          details: (err as Error).message,
        },
      );
    }
  },
);
