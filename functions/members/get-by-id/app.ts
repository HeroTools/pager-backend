import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getMember } from './helpers/get-member';
import { successResponse, errorResponse } from './utils/response';
import { supabase } from './utils/supabase-client';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return successResponse(null);
        }

        const memberId = event.pathParameters?.id;
        const workspaceId = event.pathParameters?.workspaceId;

        if (!memberId || !workspaceId) {
            return errorResponse('Member ID and workspace ID are required', 400);
        }

        // Get the requested member with user data
        const { data: member, error } = await supabase
            .from('workspace_members')
            .select(
                `
          *,
          users!workspace_members_user_id_fkey1(
            id,
            name,
            image,
            email
          )
        `,
            )
            .eq('workspace_id', workspaceId)
            .eq('user_id', memberId)
            .single();

        if (error || !member) {
            return successResponse(null);
        }

        // Check if current user is a member of the same workspace
        const currentMember = await getMember(workspaceId, userId);

        if (!currentMember) {
            return successResponse(null);
        }

        return successResponse({
            ...member,
            user: member.users,
        });
    } catch (error) {
        console.error('Error getting member by ID:', error);
        return errorResponse('Internal server error', 500);
    }
};
