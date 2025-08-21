import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';
import { McpConnectionFilters, McpConnectionWithCreator } from '../types';

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
});

const queryParamsSchema = z.object({
  provider: z.string().optional(),
  status: z.enum(['active', 'inactive', 'error', 'pending_auth']).optional(),
  include_inactive: z
    .string()
    .transform((val) => val === 'true')
    .optional(),
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

      const queryParamsResult = queryParamsSchema.safeParse(event.queryStringParameters || {});
      if (!queryParamsResult.success) {
        return errorResponse(
          `Invalid query parameters: ${queryParamsResult.error.issues.map((i) => i.message).join(', ')}`,
          400,
        );
      }
      const filters: McpConnectionFilters = queryParamsResult.data;

      const currentMember = await getMember(workspaceId, userId);
      if (!currentMember) return errorResponse('Not a member of this workspace', 403);

      client = await dbPool.connect();

      let whereConditions = ['mc.workspace_id = $1'];
      const queryParams: any[] = [workspaceId];
      let paramCounter = 2;

      if (filters.provider) {
        whereConditions.push(`mc.provider = $${paramCounter}`);
        queryParams.push(filters.provider);
        paramCounter++;
      }

      if (filters.status) {
        whereConditions.push(`mc.status = $${paramCounter}`);
        queryParams.push(filters.status);
        paramCounter++;
      } else if (!filters.include_inactive) {
        // Include active and pending_auth by default, exclude inactive and error
        whereConditions.push(`mc.status IN ('active', 'pending_auth')`);
      }

      const query = `
        SELECT
          mc.id,
          mc.workspace_id,
          mc.provider,
          mc.name,
          mc.description,
          mc.server_url,
          mc.server_label,
          mc.auth_headers,
          mc.oauth_config,
          mc.require_approval,
          mc.allowed_tools,
          mc.status,
          mc.last_tested_at,
          mc.created_by_user_id,
          mc.created_at,
          mc.updated_at,
          u.id as creator_id,
          u.name as creator_name,
          u.email as creator_email,
          u.image as creator_image
        FROM mcp_connections mc
        LEFT JOIN users u ON mc.created_by_user_id = u.id
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY mc.created_at DESC
      `;

      const result = await client.query(query, queryParams);

      const connections: McpConnectionWithCreator[] = result.rows.map((row: any) => ({
        id: row.id,
        workspace_id: row.workspace_id,
        provider: row.provider,
        name: row.name,
        description: row.description,
        server_url: row.server_url,
        server_label: row.server_label,
        auth_headers: row.auth_headers,
        oauth_config: row.oauth_config,
        require_approval: row.require_approval,
        allowed_tools: row.allowed_tools,
        status: row.status,
        last_tested_at: row.last_tested_at,
        created_by_user_id: row.created_by_user_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        created_by: row.creator_id
          ? {
              id: row.creator_id,
              name: row.creator_name,
              email: row.creator_email,
              image: row.creator_image,
            }
          : null,
      }));

      return successResponse(connections, 200);
    } catch (err) {
      console.error('Error getting MCP connections:', err);
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
