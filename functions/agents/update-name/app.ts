import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { withCors } from '../../common/utils/cors';
import dbPool from '../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../common/utils/response';

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
  agentId: z.string().uuid('Invalid agent ID format'),
});

const bodySchema = z.object({
  name: z.string().min(1, 'Agent name is required').max(100, 'Agent name too long'),
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
      const { workspaceId, agentId } = pathParamsResult.data;

      if (!event.body) {
        return errorResponse('Request body is required', 400);
      }

      const bodyResult = bodySchema.safeParse(JSON.parse(event.body));
      if (!bodyResult.success) {
        return errorResponse(
          `Invalid request body: ${bodyResult.error.issues.map((i) => i.message).join(', ')}`,
          400,
        );
      }
      const { name } = bodyResult.data;

      const currentMember = await getMember(workspaceId, userId);
      if (!currentMember) return errorResponse('Not a member of this workspace', 403);

      client = await dbPool.connect();

      const checkAgentQuery = `
        SELECT id, name, workspace_id, created_by_user_id
        FROM agents
        WHERE id = $1 AND workspace_id = $2 AND is_active = true
      `;

      const checkResult = await client.query(checkAgentQuery, [agentId, workspaceId]);

      if (checkResult.rows.length === 0) {
        return errorResponse('Agent not found', 404);
      }

      const updateQuery = `
        UPDATE agents
        SET
          name = $1,
          updated_at = now()
        WHERE id = $2 AND workspace_id = $3
        RETURNING
          id,
          name,
          description,
          model,
          avatar_url,
          is_active,
          created_at,
          updated_at
      `;

      const updateResult = await client.query(updateQuery, [name, agentId, workspaceId]);

      if (updateResult.rows.length === 0) {
        return errorResponse('Failed to update agent', 500);
      }

      const updatedAgent = {
        id: updateResult.rows[0].id,
        name: updateResult.rows[0].name,
        description: updateResult.rows[0].description,
        model: updateResult.rows[0].model,
        avatar_url: updateResult.rows[0].avatar_url,
        is_active: updateResult.rows[0].is_active,
        created_at: updateResult.rows[0].created_at,
        updated_at: updateResult.rows[0].updated_at,
      };

      return successResponse(updatedAgent, 200);
    } catch (err) {
      console.error('Error renaming agent:', err);
      if (err instanceof SyntaxError) {
        return errorResponse('Invalid JSON in request body', 400);
      }
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
