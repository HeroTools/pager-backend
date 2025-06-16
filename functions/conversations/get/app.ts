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

        // Get current member
        const currentMember = await getMember(workspaceId, userId);

        if (!currentMember) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // Get all conversations where user is either member one or member two
        const { data: conversations, error } = await supabase
            .from('conversations')
            .select(
                `
          *,
          member_one:members!conversations_member_one_id_fkey(
            id,
            role,
            users!inner(
              id,
              name,
              image
            )
          ),
          member_two:members!conversations_member_two_id_fkey(
            id,
            role,
            users!inner(
              id,
              name,
              image
            )
          )
        `,
            )
            .eq('workspace_id', workspaceId)
            .or(`member_one_id.eq.${currentMember.id},member_two_id.eq.${currentMember.id}`)
            .order('updated_at', { ascending: false });

        if (error) {
            throw error;
        }

        return successResponse(conversations || []);
    } catch (error) {
        console.error('Error getting conversations:', error);
        return errorResponse('Internal server error', 500);
    }
};
