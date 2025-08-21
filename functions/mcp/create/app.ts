import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { randomBytes } from 'crypto';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';
import { CreateMcpConnectionRequest, McpConnection, OAuthInitiationResponse } from '../types';

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
});

const bodySchema = z.object({
  provider: z.string().min(1, 'Provider is required'),
  name: z.string().min(1, 'Name is required').max(255, 'Name too long'),
  description: z.string().max(500, 'Description too long').optional(),
  server_url: z.string().url('Invalid server URL'),
  server_label: z.string().min(1, 'Server label is required').max(100, 'Server label too long'),
  auth_headers: z.record(z.string()).optional(),
  oauth_config: z
    .object({
      scopes: z.array(z.string()).default(['read']),
      authorization_url: z.string().url().optional(),
      token_url: z.string().url().optional(),
    })
    .optional(),
  require_approval: z.boolean().optional().default(false),
  allowed_tools: z.array(z.string()).optional(),
});

// OAuth configuration for different providers
const OAUTH_CONFIGS = {
  linear: {
    authorization_url: 'https://linear.app/oauth/authorize',
    token_url: 'https://api.linear.app/oauth/token',
    default_scopes: ['read', 'write', 'issues:create'],
  },
};

function generateSecureState(): string {
  return randomBytes(32).toString('hex');
}

function getCallbackUrl(): string {
  // Use simplified callback URL for OAuth providers that don't support wildcards
  const baseUrl = process.env.API_DOMAIN || 'https://api.your-domain.com';
  return `${baseUrl}/mcp/oauth/callback`;
}

async function initiateLinearOAuth(
  client: PoolClient,
  connectionId: string,
  workspaceId: string,
  userId: string,
  scopes: string[],
): Promise<OAuthInitiationResponse> {
  const state = generateSecureState();
  const callbackUrl = getCallbackUrl();

  // Store OAuth state for validation
  await client.query(
    `
    INSERT INTO mcp_oauth_states (connection_id, state, provider, workspace_id, user_id)
    VALUES ($1, $2, $3, $4, $5)
  `,
    [connectionId, state, 'linear', workspaceId, userId],
  );

  // Linear OAuth uses client_id from dynamic registration
  // For now, we'll use a placeholder and implement dynamic registration later
  const authUrl = new URL(OAUTH_CONFIGS.linear.authorization_url);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', process.env.LINEAR_CLIENT_ID || ''); // Will be replaced with dynamic registration
  authUrl.searchParams.set('redirect_uri', callbackUrl);
  authUrl.searchParams.set('scope', scopes.join(' '));
  authUrl.searchParams.set('state', state);

  return {
    authorization_url: authUrl.toString(),
    state,
    connection_id: connectionId,
  };
}

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
      const { workspaceId } = pathParamsResult.data;

      let body: CreateMcpConnectionRequest;
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

      // Check if server_label is unique within the workspace
      const labelCheckQuery = `
        SELECT id FROM mcp_connections
        WHERE workspace_id = $1 AND server_label = $2
      `;
      const labelCheckResult = await client.query(labelCheckQuery, [
        workspaceId,
        validatedBody.server_label,
      ]);

      if (labelCheckResult.rows.length > 0) {
        return errorResponse('Server label must be unique within the workspace', 409);
      }

      // Determine if this is an OAuth flow
      const isOAuthProvider = validatedBody.oauth_config || validatedBody.provider === 'linear';
      const initialStatus = isOAuthProvider ? 'pending_auth' : 'active';

      const insertQuery = `
        INSERT INTO mcp_connections (
          workspace_id,
          provider,
          name,
          description,
          server_url,
          server_label,
          auth_headers,
          oauth_config,
          require_approval,
          allowed_tools,
          status,
          created_by_user_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING
          id,
          workspace_id,
          provider,
          name,
          description,
          server_url,
          server_label,
          auth_headers,
          oauth_config,
          require_approval,
          allowed_tools,
          status,
          last_tested_at,
          created_by_user_id,
          created_at,
          updated_at
      `;

      const insertResult = await client.query(insertQuery, [
        workspaceId,
        validatedBody.provider,
        validatedBody.name,
        validatedBody.description || null,
        validatedBody.server_url,
        validatedBody.server_label,
        validatedBody.auth_headers ? JSON.stringify(validatedBody.auth_headers) : null,
        validatedBody.oauth_config ? JSON.stringify(validatedBody.oauth_config) : null,
        validatedBody.require_approval,
        validatedBody.allowed_tools || null,
        initialStatus,
        userId,
      ]);

      const connection: McpConnection = {
        id: insertResult.rows[0].id,
        workspace_id: insertResult.rows[0].workspace_id,
        provider: insertResult.rows[0].provider,
        name: insertResult.rows[0].name,
        description: insertResult.rows[0].description,
        server_url: insertResult.rows[0].server_url,
        server_label: insertResult.rows[0].server_label,
        auth_headers: insertResult.rows[0].auth_headers,
        oauth_config: insertResult.rows[0].oauth_config,
        require_approval: insertResult.rows[0].require_approval,
        allowed_tools: insertResult.rows[0].allowed_tools,
        status: insertResult.rows[0].status,
        last_tested_at: insertResult.rows[0].last_tested_at,
        created_by_user_id: insertResult.rows[0].created_by_user_id,
        created_at: insertResult.rows[0].created_at,
        updated_at: insertResult.rows[0].updated_at,
      };

      // If this is an OAuth provider, initiate the OAuth flow
      if (isOAuthProvider && validatedBody.provider === 'linear') {
        const scopes = validatedBody.oauth_config?.scopes || OAUTH_CONFIGS.linear.default_scopes;
        const oauthResponse = await initiateLinearOAuth(
          client,
          connection.id,
          workspaceId,
          userId,
          scopes,
        );

        return successResponse(
          {
            connection,
            oauth: oauthResponse,
          },
          201,
        );
      }

      return successResponse(connection, 201);
    } catch (error: unknown) {
      console.error('Error creating MCP connection:', error);

      if (error && typeof error === 'object' && 'code' in error) {
        const dbError = error as { code: string; detail?: string; constraint?: string };

        switch (dbError.code) {
          case '23505':
            if (dbError.constraint === 'mcp_connections_workspace_label_unique') {
              return errorResponse('Server label must be unique within the workspace', 409);
            }
            return errorResponse('MCP connection already exists', 409);
          case '23503':
            return errorResponse('Invalid workspace or user reference', 400);
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
