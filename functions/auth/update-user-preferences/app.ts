import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse, errorResponse } from '../../common/utils/response';
import { UpdateUserPreferencesRequest } from '../types';
import { withCors } from '../../common/utils/cors';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);

      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const body: UpdateUserPreferencesRequest = JSON.parse(event.body || '{}');
      const { last_workspace_id } = body;

      // Validate that the workspace exists and user has access to it
      if (last_workspace_id) {
        const { data: workspaceMember, error: workspaceError } = await supabase
          .from('workspace_members')
          .select('id')
          .eq('workspace_id', last_workspace_id)
          .eq('user_id', userId)
          .single();

        if (workspaceError || !workspaceMember) {
          return errorResponse('Workspace not found or access denied', 404);
        }
      }

      const updateData: any = {};
      if (last_workspace_id !== undefined) updateData.last_workspace_id = last_workspace_id;

      if (Object.keys(updateData).length === 0) {
        return errorResponse('No preferences to update', 400);
      }

      updateData.updated_at = new Date().toISOString();

      // Update user preferences
      const { data, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select()
        .single();

      if (error) {
        console.error('Error updating user preferences:', error);
        return errorResponse('Failed to update user preferences', 500);
      }

      return successResponse({ preferences: data });
    } catch (error) {
      console.error('Error updating user preferences:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
