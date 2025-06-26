import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { supabase } from './utils/supabase-client';
import { successResponse, errorResponse } from './utils/response';
import { getMember } from './helpers/get-member';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const reactionId = event.pathParameters?.reactionId;

        if (!reactionId) {
            return errorResponse('Reaction ID is required', 400);
        }

        // Get reaction with message and workspace info
        const { data: reaction, error: reactionError } = await supabase
            .from('reactions')
            .select(
                `
          *,
          messages!inner(workspace_id)
        `,
            )
            .eq('id', reactionId)
            .single();

        if (reactionError || !reaction) {
            return errorResponse('Reaction not found', 404);
        }

        // Verify user is a member of the workspace
        const member = await getMember(reaction.messages.workspace_id, userId);

        if (!member) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // Verify user owns this reaction or is an admin
        if (reaction.member_id !== member.id && member.role !== 'admin') {
            return errorResponse('Can only remove your own reactions', 403);
        }

        // Delete reaction
        const { error } = await supabase.from('reactions').delete().eq('id', reactionId);

        if (error) {
            throw error;
        }

        return successResponse({ reactionId });
    } catch (error) {
        console.error('Error removing reaction:', error);
        return errorResponse('Internal server error', 500);
    }
};
