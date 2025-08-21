import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { PoolClient } from 'pg';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';
import { UpdateMcpConnectionRequest, McpConnection } from '../types';

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
  connectionId: z.string().uuid('Invalid connection ID format'),
});

const bodySchema = z.object({
  name: z.string().min(1, 'Name is required').max(255, 'Name too long').optional(),
  description: z.string().max(500, 'Description too long').optional(),
  server_url: z.string().url('Invalid server URL').optional(),
  server_label: z.string().min(1, 'Server label is required').max(100, 'Server label too long').optional(),
  auth_headers: z.record(z.string()).optional(),
  require_approval: z.boolean().optional(),
  allowed_tools: z.array(z.string()).optional(),
  status: z.enum(['active', 'inactive']).optional(),
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
      const { workspaceId, connectionId } = pathParamsResult.data;

      let body: UpdateMcpConnectionRequest;
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

      // Check if body has at least one field to update
      if (Object.keys(validatedBody).length === 0) {
        return errorResponse('At least one field must be provided for update', 400);
      }

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

      // Check if server_label is unique within the workspace (if being updated)
      if (validatedBody.server_label) {
        const labelCheckQuery = `
          SELECT id FROM mcp_connections 
          WHERE workspace_id = $1 AND server_label = $2 AND id != $3
        `;
        const labelCheckResult = await client.query(labelCheckQuery, [
          workspaceId, 
          validatedBody.server_label,
          connectionId
        ]);
        
        if (labelCheckResult.rows.length > 0) {
          return errorResponse('Server label must be unique within the workspace', 409);
        }
      }

      // Build dynamic update query
      const updateFields: string[] = [];
      const updateParams: any[] = [];
      let paramCounter = 1;

      if (validatedBody.name !== undefined) {
        updateFields.push(`name = $${paramCounter}`);
        updateParams.push(validatedBody.name);
        paramCounter++;
      }

      if (validatedBody.description !== undefined) {
        updateFields.push(`description = $${paramCounter}`);
        updateParams.push(validatedBody.description);
        paramCounter++;
      }

      if (validatedBody.server_url !== undefined) {
        updateFields.push(`server_url = $${paramCounter}`);
        updateParams.push(validatedBody.server_url);
        paramCounter++;
      }

      if (validatedBody.server_label !== undefined) {
        updateFields.push(`server_label = $${paramCounter}`);
        updateParams.push(validatedBody.server_label);
        paramCounter++;
      }

      if (validatedBody.auth_headers !== undefined) {
        updateFields.push(`auth_headers = $${paramCounter}`);
        updateParams.push(validatedBody.auth_headers ? JSON.stringify(validatedBody.auth_headers) : null);
        paramCounter++;
      }

      if (validatedBody.require_approval !== undefined) {
        updateFields.push(`require_approval = $${paramCounter}`);
        updateParams.push(validatedBody.require_approval);
        paramCounter++;
      }

      if (validatedBody.allowed_tools !== undefined) {
        updateFields.push(`allowed_tools = $${paramCounter}`);
        updateParams.push(validatedBody.allowed_tools);
        paramCounter++;
      }

      if (validatedBody.status !== undefined) {
        updateFields.push(`status = $${paramCounter}`);
        updateParams.push(validatedBody.status);
        paramCounter++;
      }

      // Always update the updated_at timestamp
      updateFields.push(`updated_at = now()`);

      // Add WHERE clause parameters
      updateParams.push(connectionId, workspaceId);
      const whereClause = `WHERE id = $${paramCounter} AND workspace_id = $${paramCounter + 1}`;

      const updateQuery = `
        UPDATE mcp_connections 
        SET ${updateFields.join(', ')}
        ${whereClause}
        RETURNING 
          id,
          workspace_id,
          provider,
          name,
          description,
          server_url,
          server_label,
          auth_headers,
          require_approval,
          allowed_tools,
          status,
          last_tested_at,
          created_by_user_id,
          created_at,
          updated_at
      `;

      const updateResult = await client.query(updateQuery, updateParams);

      const connection: McpConnection = {
        id: updateResult.rows[0].id,
        workspace_id: updateResult.rows[0].workspace_id,
        provider: updateResult.rows[0].provider,
        name: updateResult.rows[0].name,
        description: updateResult.rows[0].description,
        server_url: updateResult.rows[0].server_url,
        server_label: updateResult.rows[0].server_label,
        auth_headers: updateResult.rows[0].auth_headers,
        require_approval: updateResult.rows[0].require_approval,
        allowed_tools: updateResult.rows[0].allowed_tools,
        status: updateResult.rows[0].status,
        last_tested_at: updateResult.rows[0].last_tested_at,
        created_by_user_id: updateResult.rows[0].created_by_user_id,
        created_at: updateResult.rows[0].created_at,
        updated_at: updateResult.rows[0].updated_at,
      };

      return successResponse(connection, 200);
    } catch (error: unknown) {
      console.error('Error updating MCP connection:', error);

      if (error && typeof error === 'object' && 'code' in error) {
        const dbError = error as { code: string; detail?: string; constraint?: string };

        switch (dbError.code) {
          case '23505':
            if (dbError.constraint === 'mcp_connections_workspace_label_unique') {
              return errorResponse('Server label must be unique within the workspace', 409);
            }
            return errorResponse('MCP connection conflict', 409);
          case '23503':
            return errorResponse('Invalid reference', 400);
          case '23514':
            return errorResponse('Invalid MCP connection data', 400);
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