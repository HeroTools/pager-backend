import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { withCors } from '../../../common/utils/cors';
import { errorResponse, successResponse } from '../../../common/utils/response';
import { supabase } from '../../../common/utils/supabase-client';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const workspaceId = event.pathParameters?.workspaceId;
    const attachmentId = event.pathParameters?.attachmentId;
    if (!workspaceId || !z.string().uuid().safeParse(workspaceId).success) {
      return errorResponse('Invalid workspaceId in path parameters', 400);
    }
    if (!attachmentId || !z.string().uuid().safeParse(attachmentId).success) {
      return errorResponse('Invalid attachmentId in path parameters', 400);
    }

    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      // 1. Verify the file record exists and belongs to the user, and is in 'uploading' state
      const { data: fileRecord, error: fetchError } = await supabase
        .from('uploaded_files')
        .select('id, s3_key, s3_bucket') // Select id for the update operation
        .eq('id', attachmentId)
        .eq('workspace_id', workspaceId)
        .eq('uploaded_by', userId)
        .eq('status', 'uploading')
        .single();

      if (fetchError || !fileRecord) {
        // Log for debugging if needed, but client doesn't need specifics
        return errorResponse('File record not found, already confirmed, or unauthorized', 404);
      }

      // 2. Update file status to 'uploaded' in your database.
      // We're trusting the client's report of successful upload to S3 via the signed URL.
      // A separate background process will handle orphaned records if the client lied or failed.
      const { data: updatedFileRecord, error: updateDbError } = await supabase
        .from('uploaded_files')
        .update({
          status: 'uploaded',
          updated_at: new Date().toISOString(),
        })
        .eq('id', attachmentId)
        .eq('workspace_id', workspaceId)
        .eq('status', 'uploading')
        .select()
        .single();

      if (updateDbError) {
        console.error('Failed to update file record status in DB:', updateDbError);
        return errorResponse('Failed to finalize file record in database', 500);
      }

      delete updatedFileRecord.public_url;
      const fileData = {
        ...updatedFileRecord,
        storage_url: `${process.env.SUPABASE_URL}/storage/v1/object/${updatedFileRecord.s3_bucket}/${updatedFileRecord.s3_key}`,
      };

      return successResponse(
        {
          message: 'File upload confirmed successfully',
          file: fileData,
        },
        200,
      );
    } catch (error) {
      console.error('Unexpected Confirm upload error:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
