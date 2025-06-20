import { supabase } from './utils/supabase-client';
import { errorResponse, successResponse } from './utils/response';
import { getUserIdFromToken } from './helpers/auth';

export const handler = async (event: any) => {
    try {
        const { attachmentId, workspaceId } = JSON.parse(event.body);

        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        // Get attachment details
        const { data: attachment, error: fetchError } = await supabase
            .from('attachments')
            .select('*')
            .eq('id', attachmentId)
            .eq('workspace_id', workspaceId)
            .eq('uploaded_by', userId)
            .single();

        if (fetchError || !attachment) {
            return errorResponse('Attachment not found', 404);
        }

        // Check if attachment is linked to any messages
        const { data: messageLinks, error: linkError } = await supabase
            .from('message_attachments')
            .select('id')
            .eq('attachment_id', attachmentId)
            .limit(1);

        if (linkError) {
            return errorResponse('Failed to check message links', 500);
        }

        // If linked to messages, just mark as orphaned for cleanup job
        if (messageLinks && messageLinks.length > 0) {
            await supabase.from('attachments').update({ status: 'orphaned' }).eq('id', attachmentId);
        } else {
            // Not linked, safe to delete immediately

            // Delete from storage
            const { error: storageError } = await supabase.storage.from('attachments').remove([attachment.s3_key]);

            if (storageError) {
                console.error('Storage deletion error:', storageError);
                // Continue with database deletion even if storage fails
            }

            // Delete from database
            const { error: dbError } = await supabase.from('attachments').delete().eq('id', attachmentId);

            if (dbError) {
                return errorResponse('Failed to delete attachment', 500);
            }
        }

        return successResponse({
            success: true,
        });
    } catch (error) {
        console.error('Delete attachment error:', error);
        return errorResponse('Internal server error', 500);
    }
};
