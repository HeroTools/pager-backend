import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import dbPool from '../../common/utils/create-db-pool';
import { errorResponse, successResponse, setCorsHeaders } from '../../common/utils/response';

interface WorkspaceInfo {
  name: string;
  image?: string;
  is_active: boolean;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  const headers = setCorsHeaders(event.headers.origin);
  if (event.httpMethod === 'OPTIONS') {
    return successResponse('', 200, headers);
  }

  let client: PoolClient | null = null;

  try {
    if (event.httpMethod !== 'GET') {
      return errorResponse('Method Not Allowed', 405);
    }

    const inviteToken = event.queryStringParameters?.token;

    if (!inviteToken) {
      return errorResponse('Invite token is required', 400);
    }

    client = await dbPool.connect();

    const query = `
      SELECT 
        w.name,
        w.image,
        w.is_active
      FROM workspaces w
      INNER JOIN workspace_invite_tokens wit ON w.id = wit.workspace_id
      WHERE wit.token = $1
        AND wit.expires_at > NOW()
        AND w.is_active = true
        AND (wit.max_uses IS NULL OR wit.usage_count < wit.max_uses)
    `;

    const result = await client.query(query, [inviteToken]);

    if (result.rows.length === 0) {
      return errorResponse('Invalid or expired invite token', 404);
    }

    const workspace = result.rows[0];
    const workspaceInfo: WorkspaceInfo = {
      name: workspace.name,
      image: workspace.image,
      is_active: workspace.is_active,
    };

    return successResponse(
      {
        workspace: workspaceInfo,
      },
      200,
      headers,
    );
  } catch (error) {
    console.error('Error fetching workspace info:', error);

    return errorResponse('Internal Server Error', 500);
  } finally {
    if (client) {
      client.release();
    }
  }
};
