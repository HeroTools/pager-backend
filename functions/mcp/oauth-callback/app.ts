import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { PoolClient } from 'pg';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format').optional(),
});

const queryParamsSchema = z.object({
  code: z.string().min(1, 'Authorization code is required'),
  state: z.string().min(1, 'State parameter is required'),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';

async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
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
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(`Token exchange failed: ${errorData.error || response.statusText}`);
  }

  return response.json();
}

async function updateConnectionWithTokens(
  client: PoolClient,
  connectionId: string,
  tokenData: {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type: string;
    scope: string;
  }
): Promise<void> {
  const expiresAt = tokenData.expires_in 
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null;

  const oauthConfig = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token,
    token_expires_at: expiresAt,
    scopes: tokenData.scope.split(' '),
    token_type: tokenData.token_type,
  };

  await client.query(`
    UPDATE mcp_connections 
    SET 
      oauth_config = $1,
      status = 'active',
      last_tested_at = now(),
      updated_at = now()
    WHERE id = $2
  `, [JSON.stringify(oauthConfig), connectionId]);
}

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client: PoolClient | null = null;

    try {
      const pathParamsResult = pathParamsSchema.safeParse(event.pathParameters || {});
      if (!pathParamsResult.success) {
        return errorResponse(
          `Invalid path parameters: ${pathParamsResult.error.issues.map((i) => i.message).join(', ')}`,
          400,
        );
      }
      
      // WorkspaceId can be from path (legacy) or will be retrieved from OAuth state
      const workspaceIdFromPath = pathParamsResult.data.workspaceId;

      const queryParamsResult = queryParamsSchema.safeParse(event.queryStringParameters);
      if (!queryParamsResult.success) {
        return errorResponse(
          `Invalid query parameters: ${queryParamsResult.error.issues.map((i) => i.message).join(', ')}`,
          400,
        );
      }
      const { code, state, error, error_description } = queryParamsResult.data;

      // Check for OAuth errors
      if (error) {
        console.error('OAuth error:', error, error_description);
        return errorResponse(`OAuth error: ${error_description || error}`, 400);
      }

      client = await dbPool.connect();

      // Validate the state parameter and get connection info
      const stateQuery = workspaceIdFromPath
        ? `
          SELECT 
            mos.connection_id,
            mos.provider,
            mos.user_id,
            mos.workspace_id,
            mc.name,
            mc.server_label
          FROM mcp_oauth_states mos
          JOIN mcp_connections mc ON mos.connection_id = mc.id
          WHERE mos.state = $1 
            AND mos.workspace_id = $2 
            AND mos.expires_at > now()
        `
        : `
          SELECT 
            mos.connection_id,
            mos.provider,
            mos.user_id,
            mos.workspace_id,
            mc.name,
            mc.server_label
          FROM mcp_oauth_states mos
          JOIN mcp_connections mc ON mos.connection_id = mc.id
          WHERE mos.state = $1 
            AND mos.expires_at > now()
        `;
      
      const stateParams = workspaceIdFromPath ? [state, workspaceIdFromPath] : [state];
      const stateResult = await client.query(stateQuery, stateParams);
      
      if (stateResult.rows.length === 0) {
        return errorResponse('Invalid or expired OAuth state', 400);
      }

      const { connection_id, provider, user_id, workspace_id } = stateResult.rows[0];
      const workspaceId = workspace_id; // Use workspace_id from OAuth state

      if (provider !== 'linear') {
        return errorResponse(`Unsupported OAuth provider: ${provider}`, 400);
      }

      // For Linear OAuth with dynamic client registration, we need to implement
      // the dynamic registration flow. For now, we'll use environment variables
      // for client credentials as a fallback.
      const clientId = process.env.LINEAR_CLIENT_ID;
      const clientSecret = process.env.LINEAR_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        console.error('Linear OAuth credentials not configured');
        return errorResponse('OAuth configuration error. Dynamic client registration not yet implemented.', 500);
      }

      // Use the simplified callback URL for token exchange
      const redirectUri = workspaceIdFromPath 
        ? `${process.env.API_DOMAIN || 'https://api.your-domain.com'}/workspaces/${workspaceId}/mcp/oauth/callback`
        : `${process.env.API_DOMAIN || 'https://api.your-domain.com'}/mcp/oauth/callback`;

      try {
        // Exchange authorization code for access token
        const tokenData = await exchangeCodeForToken(code, redirectUri, clientId, clientSecret);

        // Update the connection with the tokens
        await updateConnectionWithTokens(client, connection_id, tokenData);

        // Clean up the OAuth state
        await client.query('DELETE FROM mcp_oauth_states WHERE state = $1', [state]);

        // Redirect to frontend with success
        const frontendUrl = process.env.FRONTEND_URL || 'https://app.your-domain.com';
        const redirectUrl = `${frontendUrl}/workspaces/${workspaceId}/settings/integrations?oauth=success&connection=${connection_id}`;

        return {
          statusCode: 302,
          headers: {
            Location: redirectUrl,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
          },
          body: '',
        };

      } catch (tokenError) {
        console.error('Token exchange error:', tokenError);
        
        // Update connection status to error
        await client.query(`
          UPDATE mcp_connections 
          SET status = 'error', updated_at = now()
          WHERE id = $1
        `, [connection_id]);

        // Clean up the OAuth state
        await client.query('DELETE FROM mcp_oauth_states WHERE state = $1', [state]);

        const frontendUrl = process.env.FRONTEND_URL || 'https://app.your-domain.com';
        const redirectUrl = `${frontendUrl}/workspaces/${workspaceId}/settings/integrations?oauth=error&message=${encodeURIComponent(tokenError.message)}`;

        return {
          statusCode: 302,
          headers: {
            Location: redirectUrl,
          },
          body: '',
        };
      }

    } catch (error: unknown) {
      console.error('Error handling OAuth callback:', error);

      const frontendUrl = process.env.FRONTEND_URL || 'https://app.your-domain.com';
      const workspaceId = pathParamsResult.data?.workspaceId || 'unknown';
      const redirectUrl = `${frontendUrl}/workspaces/${workspaceId}/settings/integrations?oauth=error&message=${encodeURIComponent('Internal server error')}`;

      return {
        statusCode: 302,
        headers: {
          Location: redirectUrl,
        },
        body: '',
      };

    } finally {
      if (client) {
        client.release();
      }
    }
  },
);