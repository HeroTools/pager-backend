import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import { errorResponse, successResponse } from '../../../common/utils/response';
import { supabase } from '../../../common/utils/supabase-client';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const authHeader = event.headers.Authorization || event.headers.authorization;
      const userId = authHeader ? await getUserIdFromToken(authHeader) : null;

      if (!userId) {
        return successResponse([]);
      }

      const workspaceId = event.pathParameters?.workspaceId;
      if (!workspaceId) {
        return errorResponse('Workspace ID is required', 400);
      }

      // Make sure they're in the workspace
      const currentMember = await getMember(workspaceId, userId);
      if (!currentMember) {
        return successResponse([]);
      }

      // Join and alias `users` as `user`
      const { data: members, error } = await supabase
        .from('workspace_members')
        .select(
          `
        *,
        user:users!workspace_members_user_id_fkey1(
          id,
          name,
          email,
          image
        )
      `,
        )
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: true });

      if (error) {
        throw error;
      }

      // members now each have a `user` object and no `users` key
      return successResponse(members || []);
    } catch (err) {
      console.error('Error getting members:', err);
      return errorResponse('Internal server error', 500);
    }
  },
);
