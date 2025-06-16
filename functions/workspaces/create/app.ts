import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { generateCode } from './helpers/generate-code';
import { errorResponse, successResponse } from './utils/response';
import { supabase } from './utils/supabase-client';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const { name } = JSON.parse(event.body || '{}');

        if (!name) {
            return errorResponse('Name is required', 400);
        }

        const joinCode = generateCode();

        // Insert workspace
        const { data: workspace, error: workspaceError } = await supabase
            .from('workspaces')
            .insert({
                name,
                user_id: userId,
                join_code: joinCode,
            })
            .select()
            .single();

        if (workspaceError) {
            return errorResponse(workspaceError.message, 500);
        }

        // Insert member (admin)
        const { error: memberError } = await supabase.from('members').insert({
            user_id: userId,
            workspace_id: workspace.id,
            role: 'admin',
        });

        if (memberError) {
            return errorResponse(memberError.message, 500);
        }

        // Insert general channel
        const { error: channelError } = await supabase.from('channels').insert({
            name: 'general',
            workspace_id: workspace.id,
        });

        if (channelError) {
            return errorResponse(channelError.message, 500);
        }

        return successResponse({ workspaceId: workspace.id });
    } catch (error: unknown) {
        console.error('Error creating workspace:', error);
        return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500);
    }
};
