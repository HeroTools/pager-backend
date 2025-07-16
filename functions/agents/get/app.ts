import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { withCors } from '../../common/utils/cors';
import dbPool from '../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../common/utils/response';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client;
    try {
      // 1) Auth & workspace check
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) return errorResponse('Unauthorized', 401);

      const workspaceId = event.pathParameters?.workspaceId;
      if (!workspaceId) return errorResponse('Workspace ID is required', 400);

      const currentMember = await getMember(workspaceId, userId);
      if (!currentMember) return errorResponse('Not a member of this workspace', 403);

      // Query parameters
      const includeInactive = event.queryStringParameters?.include_inactive === 'true';

      client = await dbPool.connect();

      // 2) Get all agents for the workspace
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

      // 3) Transform to frontend format
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
