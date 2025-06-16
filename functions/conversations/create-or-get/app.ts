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

        const { workspaceId, memberId } = JSON.parse(event.body || '{}');

        if (!workspaceId || !memberId) {
            return errorResponse('WorkspaceId and memberId are required', 400);
        }

        // Get current member (the user making the request)
        const currentMember = await getMember(workspaceId, userId);

        if (!currentMember) {
            return errorResponse('Current member not found', 404);
        }

        // Get the other member
        const { data: otherMember, error: otherMemberError } = await supabase
            .from('members')
            .select('*')
            .eq('id', memberId)
            .single();

        if (otherMemberError || !otherMember) {
            return errorResponse('Other member not found', 404);
        }

        // Verify both members are in the same workspace
        if (otherMember.workspace_id !== workspaceId) {
            return errorResponse('Members must be in the same workspace', 400);
        }

        // Check if conversation already exists between these two members
        // We need to check both directions: (memberOne, memberTwo) and (memberTwo, memberOne)
        const { data: existingConversation } = await supabase
            .from('conversations')
            .select('*')
            .eq('workspace_id', workspaceId)
            .or(
                `and(member_one_id.eq.${currentMember.id},member_two_id.eq.${otherMember.id}),and(member_one_id.eq.${otherMember.id},member_two_id.eq.${currentMember.id})`,
            )
            .single();

        if (existingConversation) {
            return successResponse({ conversationId: existingConversation.id });
        }

        // Create new conversation
        const { data: newConversation, error: insertError } = await supabase
            .from('conversations')
            .insert({
                workspace_id: workspaceId,
                member_one_id: currentMember.id,
                member_two_id: otherMember.id,
            })
            .select()
            .single();

        if (insertError) {
            throw insertError;
        }

        return successResponse({ conversationId: newConversation.id });
    } catch (error) {
        console.error('Error creating/getting conversation:', error);
        return errorResponse('Internal server error', 500);
    }
};
