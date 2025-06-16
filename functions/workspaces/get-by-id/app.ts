import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { supabase } from './utils/supabase-client';
import { errorResponse, successResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const workspaceId = event.pathParameters?.id;

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

        // Get workspace info
        const { data: workspace } = await supabase.from('workspaces').select('name').eq('id', workspaceId).single();

        return successResponse({
            name: workspace?.name,
            isMember: !!member,
        });
    } catch (error) {
        console.error('Error getting workspace info:', error);
        return errorResponse('Internal server error', 500);
    }
};
