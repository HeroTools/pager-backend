import { SQSClient, SendMessageBatchCommand } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getWorkspaceMember } from '../../common/helpers/get-member';
import { withCors } from '../../common/utils/cors';
import dbPool from '../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../common/utils/response';
import { MigrationJob } from './types';

const sqs = new SQSClient({ region: process.env.AWS_REGION || 'us-east-2' });
const MIGRATION_QUEUE_URL = process.env.MIGRATION_QUEUE_URL!;

async function createJobRecord(jobId: string, workspaceId: string, userId: string) {
  const client = await dbPool.connect();
  try {
    await client.query(
      `INSERT INTO migration_jobs (job_id, workspace_id, user_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', NOW(), NOW())`,
      [jobId, workspaceId, userId],
    );
  } finally {
    client.release();
  }
}

async function queueMigrationJob(job: MigrationJob) {
  const params = {
    QueueUrl: MIGRATION_QUEUE_URL,
    Entries: [
      {
        Id: job.jobId,
        MessageBody: JSON.stringify(job),
        MessageGroupId: job.workspaceId, // For FIFO queue to ensure order per workspace
        MessageDeduplicationId: job.jobId, // Prevent duplicate jobs
      },
    ],
  };

  try {
    const result = await sqs.send(new SendMessageBatchCommand(params));
    console.log('Migration job queued:', result);
    return result;
  } catch (error) {
    console.error('Failed to queue migration job:', error);
    throw new Error(`Failed to queue migration job: ${error.message}`);
  }
}

export const handler = withCors(
  async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
    context.callbackWaitsForEmptyEventLoop = false;
    let client;

    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const workspaceId = event.pathParameters?.workspaceId;
      if (!workspaceId) {
        return errorResponse('Workspace ID is required', 400);
      }

      client = await dbPool.connect();

      const currentMember = await getWorkspaceMember(client, workspaceId, userId);
      if (!currentMember) {
        return errorResponse('Not a member of this workspace', 403);
      }

      const { storageKey, filename, fileSize } = JSON.parse(event.body || '{}');

      if (!storageKey || !filename) {
        return errorResponse('Missing storage key or filename', 400);
      }

      if (!filename.endsWith('.zip')) {
        return errorResponse('File must be a ZIP file', 400);
      }

      if (fileSize > 100 * 1024 * 1024) {
        return errorResponse(
          'File too large for migration. Please contact support for files over 100MB.',
          400,
        );
      }

      // Check if there's already a pending migration for this workspace
      const { rows: existingJobs } = await client.query(
        `SELECT job_id FROM migration_jobs
         WHERE workspace_id = $1 AND status IN ('pending', 'processing')
         ORDER BY created_at DESC LIMIT 1`,
        [workspaceId],
      );

      if (existingJobs.length > 0) {
        return errorResponse(
          `A migration is already in progress for this workspace. Job ID: ${existingJobs[0].job_id}`,
          409,
        );
      }

      const jobId = uuidv4();

      // Create job record in database
      await createJobRecord(jobId, workspaceId, userId);

      // Queue the migration job
      const migrationJob: MigrationJob = {
        jobId,
        workspaceId,
        userId,
        storageKey,
        filename,
        fileSize,
      };

      await queueMigrationJob(migrationJob);

      console.log(`Migration job ${jobId} queued for workspace ${workspaceId}`);

      return successResponse({
        success: true,
        jobId,
        message:
          'Migration job has been queued and will be processed in the background. Use the job ID to check progress.',
        estimatedProcessingTime: '5-15 minutes depending on data size',
      });
    } catch (error) {
      console.error('Migration queue error:', error);

      let errorMessage = 'Failed to queue migration job';
      if (error.message.includes('Failed to queue migration job')) {
        errorMessage = error.message;
      }

      return errorResponse(errorMessage, 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
