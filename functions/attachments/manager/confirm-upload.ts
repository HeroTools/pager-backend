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

        // Verify the attachment exists and belongs to the user
        const { data: attachment, error: fetchError } = await supabase
            .from('attachments')
            .select('*')
            .eq('id', attachmentId)
            .eq('workspace_id', workspaceId)
            .eq('uploaded_by', userId)
            .eq('status', 'uploading')
            .single();

        if (fetchError || !attachment) {
            return errorResponse('Attachment not found', 404);
        }

        // Verify file actually exists in storage
        const { data: fileExists, error: storageError } = await supabase.storage
            .from('attachments')
            .list(attachment.workspace_id, {
                search: attachment.s3_key.split('/').pop(),
            });

        if (storageError || !fileExists?.length) {
            // File doesn't exist, cleanup database record
            await supabase.from('attachments').delete().eq('id', attachmentId);

            return errorResponse('File upload incomplete', 400);
        }

        // Update attachment status to 'uploaded'
        const { data: updatedAttachment, error: updateError } = await supabase
            .from('attachments')
            .update({
                status: 'uploaded',
                updated_at: new Date().toISOString(),
            })
            .eq('id', attachmentId)
            .select()
            .single();

        if (updateError) {
            return errorResponse('Failed to confirm upload', 500);
        }

        return successResponse({ updatedAttachment });
    } catch (error) {
        console.error('Confirm upload error:', error);
        return errorResponse('Internal server error', 500);
    }
};
