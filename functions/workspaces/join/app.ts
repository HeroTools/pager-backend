import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { supabase } from './utils/supabase-client';
import { errorResponse, successResponse } from './utils/response';

export const joinWorkspace = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const { joinCode, workspaceId } = JSON.parse(event.body || '{}');

        if (!joinCode || !workspaceId) {
            return errorResponse('Join code and workspace ID are required', 400);
        }

        // Get workspace
        const { data: workspace, error: workspaceError } = await supabase
            .from('workspaces')
            .select('*')
            .eq('id', workspaceId)
            .single();

        if (workspaceError || !workspace) {
            return errorResponse('Workspace not found', 404);
        }

        if (workspace.join_code !== joinCode.toLowerCase()) {
            return errorResponse('Invalid join code', 400);
        }

        // Check if already a member
        const { data: existingMember } = await supabase
            .from('members')
            .select('*')
            .eq('workspace_id', workspaceId)
            .eq('user_id', userId)
            .single();

        if (existingMember) {
            return errorResponse('Already a member of this workspace', 400);
        }

        // Add user as member
        const { error: memberError } = await supabase.from('members').insert({
            user_id: userId,
            workspace_id: workspaceId,
            role: 'member',
        });

        if (memberError) {
            return errorResponse(memberError.message, 500);
        }

        return successResponse({ workspaceId });
    } catch (error) {
        console.error('Error joining workspace:', error);
        return errorResponse('Internal server error', 500);
    }
};
