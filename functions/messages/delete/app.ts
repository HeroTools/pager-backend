import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from './helpers/auth';
import { supabase } from './utils/supabase-client';
import { setCorsHeaders, errorResponse, successResponse } from './utils/response';
import { getMember } from './helpers/get-member';

/**
 * Recursively soft delete a message and all its related data
 */
const cascadeDeleteMessage = async (messageId: string, deletedAt: string): Promise<void> => {
    // 1. Hard delete all reactions to this message (reactions table doesn't support soft delete)
    const { error: reactionsError } = await supabase
        .from('reactions')
        .delete()
        .eq('message_id', messageId);

    if (reactionsError) {
        console.error(`Failed to delete reactions for message ${messageId}:`, reactionsError);
        // Continue with deletion even if reactions fail
    }

    // 2. Handle message attachments - mark files as orphaned and delete attachment records
    const { data: attachments, error: attachmentsError } = await supabase
        .from('message_attachments')
        .select('uploaded_file_id')
        .eq('message_id', messageId);

    if (attachmentsError) {
        console.error(`Failed to fetch attachments for message ${messageId}:`, attachmentsError);
        // Continue with deletion even if attachment fetch fails
    } else if (attachments && attachments.length > 0) {
        const fileIds = attachments.map((att: { uploaded_file_id: string }) => att.uploaded_file_id);
        
        // Mark uploaded files as orphaned for cleanup later
        const { error: orphanError } = await supabase
            .from('uploaded_files')
            .update({ status: 'orphaned' })
            .in('id', fileIds);

        if (orphanError) {
            console.error(`Failed to mark files as orphaned for message ${messageId}:`, orphanError);
        }

        // Delete message attachment records
        const { error: attachmentDeleteError } = await supabase
            .from('message_attachments')
            .delete()
            .eq('message_id', messageId);

        if (attachmentDeleteError) {
            console.error(`Failed to delete attachment records for message ${messageId}:`, attachmentDeleteError);
        }
    }

    // 3. Get all child messages (thread replies) that have this as parent
    const { data: childMessages, error: childError } = await supabase
        .from('messages')
        .select('id')
        .eq('parent_message_id', messageId)
        .is('deleted_at', null);

    if (childError) {
        console.error(`Failed to fetch child messages for ${messageId}:`, childError);
        throw childError;
    }

    // 4. Recursively delete each child message and their descendants
    if (childMessages && childMessages.length > 0) {
        for (const child of childMessages) {
            await cascadeDeleteMessage(child.id, deletedAt);
        }
    }

    // 5. Finally, soft delete the message itself
    const { error: messageError } = await supabase
        .from('messages')
        .update({ 
            deleted_at: deletedAt,
            updated_at: deletedAt
        })
        .eq('id', messageId);

    if (messageError) {
        console.error(`Failed to delete message ${messageId}:`, messageError);
        throw messageError;
    }
};

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

        // Perform cascading soft delete
        const deletedAt = new Date().toISOString();
        
        try {
            await cascadeDeleteMessage(messageId, deletedAt);
            
            console.log(`Successfully cascade deleted message ${messageId} and all related data`);
            
            return successResponse({ 
                messageId,
                deletedAt,
                cascade: true 
            }, 200, corsHeaders);
        } catch (cascadeError) {
            console.error('Error during cascade delete:', cascadeError);
            return errorResponse('Failed to delete message and related data', 500, corsHeaders);
        }
    } catch (error) {
        console.error('Error deleting message:', error);
        return errorResponse('Internal server error', 500, corsHeaders);
    }
};
