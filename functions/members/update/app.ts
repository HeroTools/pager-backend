import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getMember } from './helpers/get-member';
import { successResponse, errorResponse } from './utils/response';
import { supabase } from './utils/supabase-client';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const memberId = event.pathParameters?.id;
        const workspaceId = event.pathParameters?.workspaceId;
        const { role } = JSON.parse(event.body || '{}');

        if (!memberId || !workspaceId) {
            return errorResponse('Member ID and workspace ID are required', 400);
        }

        if (!role || !['admin', 'member'].includes(role)) {
            return errorResponse('Valid role (admin or member) is required', 400);
        }

        // Get the member to update
        const { data: memberToUpdate, error: memberError } = await supabase
            .from('workspace_members')
            .select('*')
            .eq('id', memberId)
            .eq('workspace_id', workspaceId)
            .single();

        if (memberError || !memberToUpdate) {
            return errorResponse('Member not found', 404);
        }

        // Check if current user is an admin of the workspace
        const currentMember = await getMember(workspaceId, userId);

        if (!currentMember || currentMember.role !== 'admin') {
            return errorResponse('Admin access required', 403);
        }

        // Update member role
        const { error } = await supabase
            .from('workspace_members')
            .update({
                role,
                updated_at: new Date().toISOString(),
            })
            .eq('id', memberId)
            .eq('workspace_id', workspaceId);

        if (error) {
            throw error;
        }

        return successResponse({ memberId });
    } catch (error) {
        console.error('Error updating member:', error);
        return errorResponse('Internal server error', 500);
    }
};
