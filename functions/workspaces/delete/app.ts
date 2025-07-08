import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { supabase } from '../../common/utils/supabase-client';
import { errorResponse, successResponse } from '../../common/utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const workspaceId = event.pathParameters?.workspaceId;

        if (!workspaceId) {
            return errorResponse('Workspace ID is required', 400);
        }

        // Check if user is a member
        const { data: member } = await supabase
            .from('members')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('user_id', userId)
            .single();

        if (!member) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // Delete workspace (cascade deletes should handle related records)
        const { error } = await supabase.from('workspaces').delete().eq('id', workspaceId);

        if (error) {
            throw error;
        }

        return successResponse({ workspaceId });
    } catch (error) {
        console.error('Error deleting workspace:', error);
        return errorResponse('Internal server error', 500);
    }
};
