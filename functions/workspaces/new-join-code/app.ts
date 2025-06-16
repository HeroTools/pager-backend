import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { generateCode } from './helpers/generate-code';
import { supabase } from './utils/supabase-client';
import { errorResponse, successResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const { workspaceId } = JSON.parse(event.body || '{}');

        if (!workspaceId) {
            return errorResponse('Workspace ID is required', 400);
        }

        // Check if user is an admin
        const { data: member } = await supabase
            .from('members')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('user_id', userId)
            .single();

        if (!member || member.role !== 'admin') {
            return errorResponse('Admin access required', 403);
        }

        const joinCode = generateCode();

        // Update workspace with new join code
        const { error } = await supabase.from('workspaces').update({ join_code: joinCode }).eq('id', workspaceId);

        if (error) {
            throw error;
        }

        return successResponse({ workspaceId });
    } catch (error) {
        console.error('Error generating new join code:', error);
        return errorResponse('Internal server error', 500);
    }
};
