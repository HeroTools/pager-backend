import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getMember } from './helpers/get-member';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const workspaceId = event.queryStringParameters?.workspaceId;

        if (!workspaceId) {
            return errorResponse('Workspace ID is required', 400);
        }

        // Check if user is a member of the workspace
        const member = await getMember(workspaceId, userId);

        if (!member) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // Get channels for the workspace
        const { data: channels, error } = await supabase
            .from('channels')
            .select('*')
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: true });

        if (error) {
            throw error;
        }

        return successResponse(channels || []);
    } catch (error) {
        console.error('Error getting channels:', error);
        return errorResponse('Internal server error', 500);
    }
};
