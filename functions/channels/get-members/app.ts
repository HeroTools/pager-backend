import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse, errorResponse } from '../../common/utils/response';
import { withCors } from '../../common/utils/cors';

interface ChannelMember {
  id: string;
  role: string;
  workspace_member_id: string;
}

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const channelId = event.pathParameters?.channelId;
      const workspaceId = event.pathParameters?.workspaceId;
      if (!channelId || !workspaceId) {
        return errorResponse('Channel ID and workspace ID are required', 400);
      }

      const workspaceMember = await getMember(workspaceId, userId);
      if (!workspaceMember) {
        return errorResponse('Not a member of this workspace', 403);
      }

      const { data: channel, error: channelError } = await supabase
        .from('channels')
        .select('id')
        .eq('id', channelId)
        .single();
      if (channelError || !channel) {
        return errorResponse('Channel not found', 404);
      }

      const { data: channelMembers, error: membersError } = await supabase
        .from('channel_members')
        .select(
          `
                id,
                role,
                workspace_member_id
            `,
        )
        .eq('channel_id', channelId);
      if (membersError) {
        console.error('Supabase error fetching channel members:', membersError);
        return errorResponse(
          'Failed to fetch channel members',
          500,
          {},
          {
            details: membersError.message || membersError,
          },
        );
      }

      const members = (channelMembers || []).map((cm: ChannelMember) => ({
        channel_member_id: cm.id,
        channel_role: cm.role,
        workspace_member_id: cm.workspace_member_id,
      }));
      return successResponse(members, 200);
    } catch (error) {
      console.error('Error getting channel members:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
