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
        const { name } = JSON.parse(event.body || '{}');

        if (!workspaceId) {
            return errorResponse('Workspace ID is required', 400);
        }

        if (!name) {
            return errorResponse('Name is required', 400);
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

        // Update workspace
        const { error } = await supabase.from('workspaces').update({ name }).eq('id', workspaceId);

        if (error) {
            throw error;
        }

        return successResponse({ workspaceId });
    } catch (error) {
        console.error('Error updating workspace:', error);
        return errorResponse('Internal server error', 500);
    }
};
