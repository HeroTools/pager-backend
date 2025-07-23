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

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client;
    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) return errorResponse('Unauthorized', 401);

      const pathParamsResult = pathParamsSchema.safeParse(event.pathParameters);
      if (!pathParamsResult.success) {
        return errorResponse(
          `Invalid path parameters: ${pathParamsResult.error.issues.map((i) => i.message).join(', ')}`,
          400,
        );
      }
      const { workspaceId } = pathParamsResult.data;

      const currentMember = await getMember(workspaceId, userId);
      if (!currentMember) return errorResponse('Not a member of this workspace', 403);

      client = await dbPool.connect();

      const query = `
        SELECT
          a.id,
          a.name,
          a.description,
          a.model,
          a.avatar_url,
          a.is_active,
          a.created_at,
          a.updated_at
        FROM agents a
        WHERE a.workspace_id = $1
      `;

      const result = await client.query(query, [workspaceId]);

      const agents = result.rows.map((row: any) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        model: row.model,
        avatar_url: row.avatar_url,
        is_active: row.is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
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
