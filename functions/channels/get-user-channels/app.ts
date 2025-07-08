import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { supabase } from '../../common/utils/supabase-client';
import { setCorsHeaders, successResponse, errorResponse } from '../../common/utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const origin = event.headers.Origin || event.headers.origin;
  const corsHeaders = setCorsHeaders(origin, 'GET,POST,OPTIONS');

  // 1) Handle preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders,
      body: '',
    };
  }

  try {
    const userId = await getUserIdFromToken(event.headers.Authorization);
    if (!userId) {
      return errorResponse('Unauthorized', 401, corsHeaders);
    }

    const workspaceId = event.pathParameters?.workspaceId;
    if (!workspaceId) {
      return errorResponse('Workspace ID is required', 400, corsHeaders);
    }

    const member = await getMember(workspaceId, userId);
    if (!member) {
      return errorResponse('Not a member of this workspace', 403, corsHeaders);
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

    const channels = (rawChannels || []).map(({ channel_members, ...c }) => c);
    return successResponse(channels, 200, corsHeaders);
  } catch (err) {
    console.error('Error getting user channels:', err);
    return errorResponse('Internal server error', 500, corsHeaders, {
      details: (err as Error).message,
    });
  }
};
