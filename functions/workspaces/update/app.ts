import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { supabase } from '../../common/utils/supabase-client';
import { errorResponse, successResponse } from '../../common/utils/response';
import { getMember } from '../../common/helpers/get-member';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const workspaceId = event.pathParameters?.workspaceId;
        const { name } = JSON.parse(event.body || '{}');

        if (!workspaceId) {
            return errorResponse('Workspace ID is required', 400);
        }

        if (!name) {
            return errorResponse('Name is required', 400);
        }

        const member = await getMember(workspaceId, userId);

        if (!member) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // Update workspace
        const { error } = await supabase.from('workspaces').update({ name }).eq('id', workspaceId);

        if (error) {
            throw error;
        }

        return successResponse({ workspace_id: workspaceId });
    } catch (error) {
        console.error('Error updating workspace:', error);
        return errorResponse('Internal server error', 500);
    }
};
