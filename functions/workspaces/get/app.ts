import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { errorResponse, successResponse } from './utils/response';
import { supabase } from './utils/supabase-client';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        // Get all workspace memberships for user
        const { data: members, error: membersError } = await supabase
            .from('workspace_members')
            .select(
                `
          workspace_id,
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
};
