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

        const { messageId, value } = JSON.parse(event.body || '{}');

        if (!messageId || !value) {
            return errorResponse('MessageId and value are required', 400);
        }

        // Validate emoji/reaction value
        if (typeof value !== 'string' || value.length > 10) {
            return errorResponse('Invalid reaction value', 400);
        }

        // Get message to verify it exists and get workspace
        const { data: message, error: messageError } = await supabase
            .from('messages')
            .select('workspace_id')
            .eq('id', messageId)
            .single();

        if (messageError || !message) {
            return errorResponse('Message not found', 404);
        }

        // Verify user is a member of the workspace
        const member = await getMember(message.workspace_id, userId);

        if (!member) {
            return errorResponse('Not a member of this workspace', 403);
        }

        // Check if reaction already exists
        const { data: existingReaction } = await supabase
            .from('reactions')
            .select('id')
            .eq('message_id', messageId)
            .eq('member_id', member.id)
            .eq('value', value)
            .single();

        if (existingReaction) {
            // Remove existing reaction (toggle off)
            const { error } = await supabase.from('reactions').delete().eq('id', existingReaction.id);

            if (error) {
                throw error;
            }

            return successResponse({
                action: 'removed',
                reactionId: existingReaction.id,
            });
        } else {
            // Add new reaction (toggle on)
            const { data: newReaction, error } = await supabase
                .from('reactions')
                .insert({
                    message_id: messageId,
                    member_id: member.id,
                    value,
                })
                .select()
                .single();

            if (error) {
                throw error;
            }

            return successResponse({
                action: 'added',
                reactionId: newReaction.id,
            });
        }
    } catch (error) {
        console.error('Error toggling reaction:', error);
        return errorResponse('Internal server error', 500);
    }
};
