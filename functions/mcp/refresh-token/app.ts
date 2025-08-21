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

const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';

async function refreshLinearToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  scope: string;
}> {
  const response = await fetch(LINEAR_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Token refresh failed: ${errorData.error || response.statusText}`);
  }

  return response.json();
}

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

      // Get the connection and verify ownership
      const connectionQuery = `
        SELECT 
          id,
          provider,
          oauth_config,
          status
        FROM mcp_connections 
        WHERE id = $1 AND workspace_id = $2
      `;
      
      const connectionResult = await client.query(connectionQuery, [connectionId, workspaceId]);
      
      if (connectionResult.rows.length === 0) {
        return errorResponse('Connection not found', 404);
      }

      const connection = connectionResult.rows[0];
      
      if (connection.provider !== 'linear') {
        return errorResponse('Token refresh only supported for Linear connections', 400);
      }

      if (!connection.oauth_config?.refresh_token) {
        return errorResponse('No refresh token available', 400);
      }

      // For Linear OAuth with dynamic client registration, we need to implement
      // the dynamic registration flow. For now, we'll use environment variables
      const clientId = process.env.LINEAR_CLIENT_ID;
      const clientSecret = process.env.LINEAR_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return errorResponse('OAuth configuration error', 500);
      }

      try {
        // Refresh the access token
        const tokenData = await refreshLinearToken(
          connection.oauth_config.refresh_token,
          clientId,
          clientSecret
        );

        const expiresAt = tokenData.expires_in 
          ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
          : null;

        const updatedOAuthConfig = {
          ...connection.oauth_config,
          access_token: tokenData.access_token,
          refresh_token: tokenData.refresh_token || connection.oauth_config.refresh_token,
          token_expires_at: expiresAt,
          scopes: tokenData.scope.split(' '),
          token_type: tokenData.token_type,
        };

        // Update the connection with new tokens
        await client.query(`
          UPDATE mcp_connections 
          SET 
            oauth_config = $1,
            status = 'active',
            last_tested_at = now(),
            updated_at = now()
          WHERE id = $2
        `, [JSON.stringify(updatedOAuthConfig), connectionId]);

        return successResponse({ 
          message: 'Token refreshed successfully',
          expires_at: expiresAt 
        });

      } catch (refreshError) {
        console.error('Token refresh error:', refreshError);
        
        // Update connection status to error
        await client.query(`
          UPDATE mcp_connections 
          SET status = 'error', updated_at = now()
          WHERE id = $1
        `, [connectionId]);

        return errorResponse(`Token refresh failed: ${refreshError.message}`, 500);
      }

    } catch (error: unknown) {
      console.error('Error refreshing OAuth token:', error);
      return errorResponse('Internal server error', 500);

    } finally {
      if (client) {
        client.release();
      }
    }
  },
);