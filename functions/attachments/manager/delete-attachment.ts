import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { supabase } from '../../common/utils/supabase-client';
import { errorResponse, successResponse } from '../../common/utils/response';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { withCors } from '../../common/utils/cors';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const workspaceId = event.pathParameters?.workspaceId;
      const attachmentId = event.pathParameters?.attachmentId;

      if (!workspaceId || !z.string().uuid().safeParse(workspaceId).success) {
        return errorResponse('Invalid workspaceId in path parameters', 400);
      }

      if (!attachmentId || !z.string().uuid().safeParse(attachmentId).success) {
        return errorResponse('Invalid attachmentId in path parameters', 400);
      }

      const userId = await getUserIdFromToken(event.headers.Authorization);

      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      // Get attachment details
      const { data: attachment, error: fetchError } = await supabase
        .from('uploaded_files')
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
        .eq('uploaded_file_id', attachmentId)
        .limit(1);

      if (linkError) {
        return errorResponse('Failed to check message links', 500);
      }

      // If linked to messages, just mark as orphaned for cleanup job
      if (messageLinks && messageLinks.length > 0) {
        await supabase.from('uploaded_files').update({ status: 'orphaned' }).eq('id', attachmentId);
      } else {
        // Not linked, safe to delete immediately

        // Delete from storage
        const { error: storageError } = await supabase.storage
          .from('uploaded_files')
          .remove([attachment.s3_key]);

        if (storageError) {
          console.error('Storage deletion error:', storageError);
          // Continue with database deletion even if storage fails
        }

        // Delete from database
        const { error: dbError } = await supabase
          .from('uploaded_files')
          .delete()
          .eq('id', attachmentId);

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
  },
);
