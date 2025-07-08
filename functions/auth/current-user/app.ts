import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse, errorResponse } from '../../common/utils/response';

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

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(event.headers.Authorization?.substring(7));

    if (authError || !user) {
      return errorResponse('Invalid token', 401);
    }

    const userProfilePromise = supabase.from('users').select('*').eq('id', userId).single();

    const memberPromise = supabase
      .from('workspace_members')
      .select('id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .single();

    const [userProfile, member] = await Promise.all([userProfilePromise, memberPromise]);

    if (userProfile.error) {
      console.error('Error getting user profile:', userProfile.error);
    }

    if (member.error || !member.data) {
      return errorResponse('User not found in workspace', 404);
    }

    return successResponse({
      ...userProfile.data,
      email_confirmed_at: user.email_confirmed_at,
      role: member.data.role || 'member',
      workspace_member_id: member.data.id,
    });
  } catch (error) {
    console.error('Error getting current user:', error);
    return errorResponse('Internal server error', 500);
  }
};
