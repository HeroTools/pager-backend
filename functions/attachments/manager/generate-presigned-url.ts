import { z } from 'zod';
import { getUserIdFromToken } from './helpers/auth';
import { getMember } from './helpers/get-member';
import { errorResponse, successResponse } from './utils/response';
import { supabase } from './utils/supabase-client';

const presignedUrlRequestSchema = z.object({
    workspaceId: z.string().uuid('Invalid workspaceId format (must be a UUID)'),
    fileId: z.string().uuid('Invalid fileId format (must be a UUID)'),
    filename: z.string().min(1, 'Filename cannot be empty'),
    contentType: z.string().min(1, 'Content type cannot be empty'),
    sizeBytes: z.number().int().min(0, 'File size must be a non-negative integer'),
});

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_CONTENT_TYPES_PREFIXES = [
    'image/',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument',
    'video/',
    'audio/',
    'text/',
    'application/zip',
];

export const handler = async (event: any) => {
    try {
        let requestBody;
        try {
            requestBody = JSON.parse(event.body);
        } catch (parseError) {
            return errorResponse('Invalid JSON in request body', 400);
        }

        const validationResult = presignedUrlRequestSchema.safeParse(requestBody);

        if (!validationResult.success) {
            const errorMessages = validationResult.error.errors.map((err) => `${err.path.join('.')}: ${err.message}`);
            console.error('Validation Error:', errorMessages);
            return errorResponse(`Validation failed: ${errorMessages.join(', ')}`, 400);
        }

        const { workspaceId, fileId, filename, contentType, sizeBytes } = validationResult.data;

        const userId = await getUserIdFromToken(event.headers.Authorization);

        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const { workspaceMember, memberError } = await getMember(workspaceId, userId);

        if (memberError || !workspaceMember) {
            return errorResponse('Not a workspace member', 403);
        }

        if (sizeBytes > MAX_FILE_SIZE_BYTES) {
            return errorResponse(`File too large. Max size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB.`, 400);
        }

        if (!ALLOWED_CONTENT_TYPES_PREFIXES.some((type) => contentType.startsWith(type))) {
            return errorResponse('File type not allowed', 400);
        }

        const fileExtension = filename.split('.').pop();
        if (!fileExtension) {
            return errorResponse('Filename must have an extension', 400);
        }
        const filePath = `${workspaceId}/${fileId}.${fileExtension}`;

        const { error: dbError } = await supabase.from('attachments').insert({
            id: fileId,
            workspace_id: workspaceId,
            s3_bucket: 'attachments',
            s3_key: filePath,
            original_filename: filename,
            content_type: contentType,
            size_bytes: sizeBytes,
            uploaded_by: userId,
            status: 'uploading',
        });

        if (dbError) {
            console.error('Supabase DB Insert Error:', dbError);
            return errorResponse('Failed to create attachment record', 500);
        }

        const { data: presignedData, error: presignedError } = await supabase.storage
            .from('attachments')
            .createSignedUploadUrl(filePath, {
                upsert: true,
            });

        if (presignedError) {
            console.error('Supabase Presigned URL Error:', presignedError);
            await supabase.from('attachments').delete().eq('id', fileId);

            return errorResponse('Failed to generate presigned URL', 500);
        }

        const { data: publicUrlData } = supabase.storage.from('attachments').getPublicUrl(filePath);

        return successResponse({
            signedUrl: presignedData.signedUrl,
            token: presignedData.token,
            path: filePath,
            publicUrl: publicUrlData.publicUrl,
            attachmentId: fileId,
            expiresIn: 3600,
        });
    } catch (error) {
        console.error('Unexpected Presigned URL error:', error);
        return errorResponse('Internal server error', 500);
    }
};
