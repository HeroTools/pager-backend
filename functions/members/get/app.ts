import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { getMember } from './helpers/get-member';
import { successResponse, errorResponse } from './utils/response';
import { supabase } from './utils/supabase-client';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return successResponse([]);
        }

        const workspaceId = event.pathParameters?.workspaceId;

        if (!workspaceId) {
            return errorResponse('Workspace ID is required', 400);
        }

        // Check if user is a member of the workspace
        const currentMember = await getMember(workspaceId, userId);

        if (!currentMember) {
            return successResponse([]);
        }

        // Get all members of the workspace with user data
        const { data: members, error } = await supabase
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
            .order('created_at', { ascending: true });

        if (error) {
            throw error;
        }

        // Transform the data to include user data at the top level
        const transformedMembers = (members || []).map((member) => ({
            ...member,
            user: member.users,
        }));

        return successResponse(transformedMembers);
    } catch (error) {
        console.error('Error getting members:', error);
        return errorResponse('Internal server error', 500);
    }
};
