import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { supabase } from './utils/supabase-client';
import { setCorsHeaders, errorResponse, successResponse } from './utils/response';
import { getMember } from './helpers/get-member';

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const origin = event.headers.Origin || event.headers.origin;
    const corsHeaders = setCorsHeaders(origin, 'DELETE');

    if (event.httpMethod === 'OPTIONS') {
        return successResponse({ message: 'OK' }, 200, corsHeaders);
    }

    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401, corsHeaders);
        }

        const messageId = event.pathParameters?.messageId;

        if (!messageId) {
            return errorResponse('Message ID is required', 400, corsHeaders);
        }

        // Get message and verify it exists and is not already deleted
        const { data: message, error: messageError } = await supabase
            .from('messages')
            .select(`
                *,
                workspace_members!inner(user_id)
            `)
            .eq('id', messageId)
            .is('deleted_at', null)
            .single();

        if (messageError || !message) {
            return errorResponse('Message not found', 404, corsHeaders);
        }

        // Get the current user's member record
        const member = await getMember(message.workspace_id, userId);

        if (!member) {
            return errorResponse('Not a member of this workspace', 403, corsHeaders);
        }

        // Verify ownership - compare workspace member IDs
        if (member.id !== message.workspace_member_id) {
            return errorResponse('Can only delete your own messages', 403, corsHeaders);
        }

        // Soft delete the message by setting deleted_at timestamp
        const { error } = await supabase
            .from('messages')
            .update({ 
                deleted_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', messageId);

        if (error) {
            throw error;
        }

        return successResponse({ messageId }, 200, corsHeaders);
    } catch (error) {
        console.error('Error deleting message:', error);
        return errorResponse('Internal server error', 500, corsHeaders);
    }
};
