import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { PoolClient } from 'pg';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';
import { UpdateAgentMcpAccessRequest } from '../../mcp/types';

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
  agentId: z.string().uuid('Invalid agent ID format'),
});

const bodySchema = z.object({
  mcp_access: z.array(z.object({
    mcp_connection_id: z.string().uuid('Invalid MCP connection ID format'),
    is_enabled: z.boolean(),
  })),
});

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client: PoolClient | null = null;

    try {
      if (!event.body) {
        return errorResponse('Request body is required', 400);
      }

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
      const { workspaceId, agentId } = pathParamsResult.data;

      let body: UpdateAgentMcpAccessRequest;
      try {
        body = JSON.parse(event.body);
      } catch {
        return errorResponse('Invalid JSON in request body', 400);
      }

      const bodyResult = bodySchema.safeParse(body);
      if (!bodyResult.success) {
        return errorResponse(
          `Invalid request body: ${bodyResult.error.issues.map((i) => i.message).join(', ')}`,
          400,
        );
      }
      const validatedBody = bodyResult.data;

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

      // Verify all MCP connections belong to the workspace
      if (validatedBody.mcp_access.length > 0) {
        const connectionIds = validatedBody.mcp_access.map(access => access.mcp_connection_id);
        const connectionQuery = `
          SELECT id FROM mcp_connections 
          WHERE id = ANY($1) AND workspace_id = $2
        `;
        const connectionResult = await client.query(connectionQuery, [connectionIds, workspaceId]);
        
        if (connectionResult.rows.length !== connectionIds.length) {
          return errorResponse('One or more MCP connections not found in workspace', 400);
        }
      }

      await client.query('BEGIN');

      try {
        // Delete existing access records for this agent
        await client.query(
          'DELETE FROM agent_mcp_access WHERE agent_id = $1',
          [agentId]
        );

        // Insert new access records for enabled connections
        const enabledAccess = validatedBody.mcp_access.filter(access => access.is_enabled);
        
        if (enabledAccess.length > 0) {
          const insertValues = enabledAccess.map((access, index) => {
            const baseIndex = index * 2;
            return `($${baseIndex + 1}, $${baseIndex + 2})`;
          }).join(', ');

          const insertParams = enabledAccess.flatMap(access => [
            agentId,
            access.mcp_connection_id
          ]);

          const insertQuery = `
            INSERT INTO agent_mcp_access (agent_id, mcp_connection_id) 
            VALUES ${insertValues}
          `;

          await client.query(insertQuery, insertParams);
        }

        await client.query('COMMIT');

        // Return updated access list
        const resultQuery = `
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

        const resultData = await client.query(resultQuery, [agentId, workspaceId]);

        const accessList = resultData.rows.map((row: any) => ({
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
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } catch (error: unknown) {
      console.error('Error updating agent MCP access:', error);

      if (error && typeof error === 'object' && 'code' in error) {
        const dbError = error as { code: string; detail?: string; constraint?: string };

        switch (dbError.code) {
          case '23505':
            return errorResponse('Duplicate MCP access configuration', 409);
          case '23503':
            return errorResponse('Invalid agent or MCP connection reference', 400);
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