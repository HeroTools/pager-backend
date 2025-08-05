import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { withCors } from '../../common/utils/cors';
import { errorResponse, successResponse } from '../../common/utils/response';
import { supabase } from '../../common/utils/supabase-client';
import sanitizeFilename from './helpers/sanitize-file-name';

const ALLOWED_FILE_PURPOSES = [
  'attachments',
  'profile_pictures',
  'channel_documents',
  'temp_uploads',
  'audio_messages',
  'video_messages',
];

const presignedUrlRequestSchema = z.object({
  fileId: z.string().uuid('Invalid fileId format (must be a UUID)'),
  filename: z.string().min(1, 'Filename cannot be empty'),
  contentType: z.string().min(1, 'Content type cannot be empty'),
  sizeBytes: z.number().int().min(0, 'File size must be a non-negative integer'),
  filePurpose: z.enum(ALLOWED_FILE_PURPOSES as [string, ...string[]]),
});

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20MB
const ALLOWED_CONTENT_TYPES_PREFIXES = [
  'image/',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument', // Covers docx, xlsx, pptx
  'video/',
  'audio/',
  'text/',
  'application/zip',
];

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let requestBody;
    try {
      if (typeof event.body === 'string') {
        requestBody = JSON.parse(event.body);
      } else {
        requestBody = event.body;
      }
    } catch (parseError) {
      console.error('JSON Parse Error:', parseError);
      return errorResponse('Invalid JSON in request body', 400);
    }

    try {
      const validationResult = presignedUrlRequestSchema.safeParse(requestBody);

      if (!validationResult.success) {
        const errorMessages = validationResult.error.errors.map(
          (err) => `${err.path.join('.')}: ${err.message}`,
        );
        console.error('Validation Error:', errorMessages);
        return errorResponse(`Validation failed: ${errorMessages.join(', ')}`, 400);
      }

      const { fileId, filename, contentType, sizeBytes, filePurpose } = validationResult.data;

      const workspaceId = event.pathParameters?.workspaceId;
      if (!workspaceId || !z.string().uuid().safeParse(workspaceId).success) {
        return errorResponse('Invalid workspaceId in path parameters', 400);
      }

      const userId = await getUserIdFromToken(event.headers.Authorization);

      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const workspaceMember = await getMember(workspaceId, userId);

      if (!workspaceMember) {
        return errorResponse('Not a workspace member', 403);
      }

      if (sizeBytes > MAX_FILE_SIZE_BYTES) {
        return errorResponse(
          `File too large. Max size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`,
          400,
        );
      }

      if (!ALLOWED_CONTENT_TYPES_PREFIXES.some((type) => contentType.startsWith(type))) {
        return errorResponse('File type not allowed', 400);
      }

      const fileExtension = filename.split('.').pop();
      if (!fileExtension) {
        return errorResponse('Filename must have an extension', 400);
      }

      const sanitizedFilename = sanitizeFilename(filename);

      // Format: files/{workspace-id}/{file-purpose}/{unique-file-id}/{sanitized-filename.ext}
      const s3BucketName = 'files';
      const s3Key = `${workspaceId}/${filePurpose}/${fileId}/${sanitizedFilename}`;

      // Insert file record with public URL
      const { error: dbError } = await supabase.from('uploaded_files').insert({
        id: fileId,
        workspace_id: workspaceId,
        s3_bucket: s3BucketName,
        s3_key: s3Key,
        original_filename: filename,
        content_type: contentType,
        size_bytes: sizeBytes,
        uploaded_by: userId,
        status: 'uploading',
        file_purpose: filePurpose,
      });

      if (dbError) {
        console.error('Supabase DB Insert Error:', dbError);
        return errorResponse('Failed to create file record in database', 500);
      }

      // Generate Presigned Upload URL
      const { data: presignedData, error: presignedError } = await supabase.storage
        .from(s3BucketName)
        .createSignedUploadUrl(s3Key, {
          upsert: true,
        });

      if (presignedError) {
        console.error('Supabase Presigned URL Error:', presignedError);
        await supabase.from('uploaded_files').delete().eq('id', fileId);
        return errorResponse('Failed to generate presigned upload URL', 500);
      }

      return successResponse({
        signed_url: presignedData.signedUrl,
        token: presignedData.token,
        path: s3Key,
        storage_url: `${process.env.SUPABASE_URL}/storage/v1/object/${s3BucketName}/${s3Key}`,
        file_id: fileId,
        expires_in: 3600,
      });
    } catch (error) {
      console.error('Unexpected Presigned URL error:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
