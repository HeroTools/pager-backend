import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { PoolClient } from 'pg';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
  connectionId: z.string().uuid('Invalid connection ID format'),
});

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client: PoolClient | null = null;

    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const pathParamsResult = pathParamsSchema.safeParse(event.pathParameters);
      if (!pathParamsResult.success) {
        return errorResponse(
          `Invalid path parameters: ${pathParamsResult.error.issues.map((i) => i.message).join(', ')}`,
          400,
        );
      }
      const { workspaceId, connectionId } = pathParamsResult.data;

      const currentMember = await getMember(workspaceId, userId);
      if (!currentMember) return errorResponse('Not a member of this workspace', 403);

      client = await dbPool.connect();

      // Check if connection exists and belongs to the workspace
      const existsQuery = `
        SELECT id FROM mcp_connections 
        WHERE id = $1 AND workspace_id = $2
      `;
      const existsResult = await client.query(existsQuery, [connectionId, workspaceId]);
      
      if (existsResult.rows.length === 0) {
        return errorResponse('MCP connection not found', 404);
      }

      // Delete the connection (this will cascade delete agent_mcp_access records)
      const deleteQuery = `
        DELETE FROM mcp_connections 
        WHERE id = $1 AND workspace_id = $2
      `;
      
      await client.query(deleteQuery, [connectionId, workspaceId]);

      return successResponse({ message: 'MCP connection deleted successfully' }, 200);
    } catch (error: unknown) {
      console.error('Error deleting MCP connection:', error);

      if (error && typeof error === 'object' && 'code' in error) {
        const dbError = error as { code: string; detail?: string };

        switch (dbError.code) {
          case '23503':
            return errorResponse('Cannot delete: connection is still referenced', 400);
          default:
            console.error('Database error:', dbError);
            return errorResponse('Database operation failed', 500);
        }
      }

      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);