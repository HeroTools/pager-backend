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

        if (!memberId) {
            return errorResponse('Member ID is required', 400);
        }

        // Get the requested member with user data
        const { data: member, error } = await supabase
            .from('members')
            .select(
                `
          *,
          users!inner(
            id,
            name,
            image,
            email
          )
        `,
            )
            .eq('id', memberId)
            .single();

        if (error || !member) {
            return successResponse(null);
        }

        // Check if current user is a member of the same workspace
        const currentMember = await getMember(member.workspace_id, userId);

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
