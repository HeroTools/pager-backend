import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { withCors } from '../../common/utils/cors';
import dbPool from '../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../common/utils/response';

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
});

const queryParamsSchema = z.object({
  include_inactive: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
});

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client;
    try {
      // 1) Auth check
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) return errorResponse('Unauthorized', 401);

      // 2) Validate path parameters
      const pathParamsResult = pathParamsSchema.safeParse(event.pathParameters);
      if (!pathParamsResult.success) {
        return errorResponse(
          `Invalid path parameters: ${pathParamsResult.error.issues.map((i) => i.message).join(', ')}`,
          400,
        );
      }
      const { workspaceId } = pathParamsResult.data;

      // 3) Validate query parameters
      const queryParamsResult = queryParamsSchema.safeParse(event.queryStringParameters);
      if (!queryParamsResult.success) {
        return errorResponse(
          `Invalid query parameters: ${queryParamsResult.error.issues.map((i) => i.message).join(', ')}`,
          400,
        );
      }
      const { include_inactive: includeInactive } = queryParamsResult.data;

      // 4) Workspace membership check
      const currentMember = await getMember(workspaceId, userId);
      if (!currentMember) return errorResponse('Not a member of this workspace', 403);

      client = await dbPool.connect();

      // 5) Get all agents for the workspace
      const query = `
        SELECT
          a.id,
          a.name,
          a.description,
          a.model,
          a.avatar_url,
          a.is_active,
          a.created_at,
          a.updated_at,
          u.name as created_by_name,
          u.image as created_by_image
        FROM agents a
        LEFT JOIN users u ON a.created_by_user_id = u.id
        WHERE a.workspace_id = $1
          ${!includeInactive ? 'AND a.is_active = true' : ''}
        ORDER BY a.created_at DESC
      `;

      const result = await client.query(query, [workspaceId]);

      // 6) Transform to frontend format
      const agents = result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        model: row.model,
        avatar_url: row.avatar_url,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        created_by: row.created_by_name
          ? {
              name: row.created_by_name,
              image: row.created_by_image,
            }
          : null,
      }));

      return successResponse(agents, 200);
    } catch (err) {
      console.error('Error getting agents:', err);
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
