import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { withCors } from '../../common/utils/cors';
import { errorResponse, successResponse } from '../../common/utils/response';
import { supabase } from '../../common/utils/supabase-client';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    console.log('Received request:', event);
    try {
      const userId = await getUserIdFromToken(
        event.headers.Authorization || event.headers.authorization,
      );

      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      // Get all workspace memberships for user
      const { data: members, error: membersError } = await supabase
        .from('workspace_members')
        .select(
          `
          workspace_id,
          role,
          workspaces (
            id,
            name,
            user_id,
            created_at,
            updated_at
          )
        `,
        )
        .eq('user_id', userId);

      if (membersError) {
        return errorResponse(membersError.message, 500);
      }

      const workspaces = members?.map((member) => member.workspaces).filter(Boolean) || [];

      return successResponse(workspaces);
    } catch (error) {
      console.error('Error getting workspaces:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
