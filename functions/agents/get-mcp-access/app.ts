import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';
import { AgentMcpAccessWithConnection } from '../../mcp/types';

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
  agentId: z.string().uuid('Invalid agent ID format'),
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

      const currentMember = await getMember(workspaceId, userId);
      if (!currentMember) return errorResponse('Not a member of this workspace', 403);

      client = await dbPool.connect();

      // Check if agent exists and belongs to the workspace
      const agentQuery = `
        SELECT id FROM agents 
        WHERE id = $1 AND workspace_id = $2
      `;
      const agentResult = await client.query(agentQuery, [agentId, workspaceId]);
      
      if (agentResult.rows.length === 0) {
        return errorResponse('Agent not found', 404);
      }

      // Get all MCP connections for the workspace with agent access info
      const query = `
        SELECT
          mc.id as mcp_connection_id,
          mc.name,
          mc.provider,
          mc.server_label,
          mc.status,
          ama.id,
          ama.agent_id,
          ama.is_enabled,
          ama.created_at
        FROM mcp_connections mc
        LEFT JOIN agent_mcp_access ama ON mc.id = ama.mcp_connection_id AND ama.agent_id = $1
        WHERE mc.workspace_id = $2 AND mc.status = 'active'
        ORDER BY mc.name ASC
      `;

      const result = await client.query(query, [agentId, workspaceId]);

      const accessList: AgentMcpAccessWithConnection[] = result.rows.map((row: any) => ({
        id: row.id || null,
        agent_id: agentId,
        mcp_connection_id: row.mcp_connection_id,
        is_enabled: row.is_enabled || false,
        created_at: row.created_at || null,
        mcp_connection: {
          id: row.mcp_connection_id,
          name: row.name,
          provider: row.provider,
          server_label: row.server_label,
          status: row.status,
        },
      }));

      return successResponse(accessList, 200);
    } catch (err) {
      console.error('Error getting agent MCP access:', err);
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);