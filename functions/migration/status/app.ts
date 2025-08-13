import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getWorkspaceMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

interface JobStatus {
  jobId: string;
  workspaceId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: {
    usersCreated: number;
    channelsCreated: number;
    conversationsCreated: number;
    messagesImported: number;
    reactionsAdded: number;
  };
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

async function getJobStatus(
  jobId: string,
  workspaceId: string,
  userId: string,
): Promise<JobStatus | null> {
  const client = await dbPool.connect();
  try {
    const { rows } = await client.query(
      `SELECT mj.job_id, mj.workspace_id, mj.status, mj.progress, mj.error,
              mj.created_at, mj.updated_at, mj.completed_at
       FROM migration_jobs mj
       WHERE mj.job_id = $1 AND mj.workspace_id = $2 AND mj.user_id = $3`,
      [jobId, workspaceId, userId],
    );

    if (rows.length === 0) {
      return null;
    }

    const row = rows[0];
    return {
      jobId: row.job_id,
      workspaceId: row.workspace_id,
      status: row.status,
      progress: typeof row.progress === 'string' ? JSON.parse(row.progress) : row.progress,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  } finally {
    client.release();
  }
}

async function getWorkspaceJobs(workspaceId: string, userId: string): Promise<JobStatus[]> {
  const client = await dbPool.connect();
  try {
    const { rows } = await client.query(
      `SELECT mj.job_id, mj.workspace_id, mj.status, mj.progress, mj.error,
              mj.created_at, mj.updated_at, mj.completed_at
       FROM migration_jobs mj
       WHERE mj.workspace_id = $1 AND mj.user_id = $2
       ORDER BY mj.created_at DESC
       LIMIT 10`,
      [workspaceId, userId],
    );

    return rows.map((row) => ({
      jobId: row.job_id,
      workspaceId: row.workspace_id,
      status: row.status,
      progress: typeof row.progress === 'string' ? JSON.parse(row.progress) : row.progress,
      error: row.error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    }));
  } finally {
    client.release();
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

      const jobId = event.pathParameters?.jobId;

      if (jobId) {
        // Get specific job status
        const jobStatus = await getJobStatus(jobId, workspaceId, userId);

        if (!jobStatus) {
          return errorResponse('Job not found', 404);
        }

        return successResponse({
          success: true,
          job: jobStatus,
        });
      } else {
        // Get all jobs for workspace
        const jobs = await getWorkspaceJobs(workspaceId, userId);

        return successResponse({
          success: true,
          jobs,
        });
      }
    } catch (error) {
      console.error('Migration status error:', error);
      return errorResponse('Failed to get migration status', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
