import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import crypto from 'crypto';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { withCors } from '../../common/utils/cors';
import dbPool from '../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../common/utils/response';

const isLocal = process.env.AWS_SAM_LOCAL === 'true';

const webhookApiUrl = isLocal
  ? process.env.LOCAL_WEBHOOK_API_URL || 'http://localhost:3000'
  : process.env.WEBHOOK_API_URL;

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    const method = event.httpMethod;
    const pathParameters = event.pathParameters || {};
    const webhookId = pathParameters.webhookId;

    try {
      const userId = await getUserIdFromToken(
        event.headers.Authorization || event.headers.authorization,
      );
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      switch (method) {
        case 'POST':
          return await createWebhook(event, userId);
        case 'GET':
          if (webhookId && event.pathParameters?.details) {
            return await getWebhookDetails(webhookId, event, userId);
          }
          return await listWebhooks(event, userId);
        case 'PATCH':
          if (!webhookId) return errorResponse('Webhook ID is required', 400);
          return await updateWebhook(webhookId, event, userId);
        case 'DELETE':
          if (!webhookId) return errorResponse('Webhook ID is required', 400);
          return await deleteWebhook(webhookId, userId);
        default:
          return errorResponse('Method not allowed', 405);
      }
    } catch (error) {
      console.error('Management API error:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);

async function createWebhook(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  let body: any;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.workspace_id || !body.name) {
    return errorResponse('workspace_id and name are required', 400);
  }

  // Verify user is a member of the workspace
  const memberCheck = await dbPool.query(
    `
    SELECT id FROM workspace_members
    WHERE workspace_id = $1 AND user_id = $2 AND is_deactivated = false
  `,
    [body.workspace_id, userId],
  );

  if (memberCheck.rows.length === 0) {
    return errorResponse('User is not a member of this workspace', 403);
  }

  const secretToken = crypto.randomBytes(32).toString('hex');
  const signingSecret = crypto.randomBytes(32).toString('hex');

  const result = await dbPool.query(
    `
    INSERT INTO webhooks (workspace_id, name, secret_token, signing_secret, created_by_user_id)
    VALUES ($1, $2, $3, $4, $5)
    RETURNING id
  `,
    [body.workspace_id, body.name, secretToken, signingSecret, userId],
  );

  const newWebhookId = result.rows[0].id;
  const url = `${webhookApiUrl}/${newWebhookId}`;

  return successResponse(
    {
      id: newWebhookId,
      url,
      secret_token: secretToken,
      signing_secret: signingSecret,
    },
    201,
  );
}

async function listWebhooks(
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  const workspaceId = event.pathParameters?.workspaceId;

  if (!workspaceId) {
    return errorResponse('workspace_id path parameter is required', 400);
  }

  // Verify user is a member of the workspace
  const memberCheck = await dbPool.query(
    `
    SELECT id FROM workspace_members
    WHERE workspace_id = $1 AND user_id = $2 AND is_deactivated = false
  `,
    [workspaceId, userId],
  );

  if (memberCheck.rows.length === 0) {
    return errorResponse('User is not a member of this workspace', 403);
  }

  const result = await dbPool.query(
    `
    SELECT
      w.id,
      w.name,
      w.is_active,
      w.last_used_at,
      w.created_at,
      u.name as created_by_name,
      COUNT(wu.id) as total_requests
    FROM webhooks w
    LEFT JOIN users u ON w.created_by_user_id = u.id
    LEFT JOIN webhook_usage wu ON w.id = wu.webhook_id
    WHERE w.workspace_id = $1
    GROUP BY w.id, w.name, w.is_active, w.last_used_at, w.created_at, u.name
    ORDER BY w.created_at DESC
  `,
    [workspaceId],
  );

  return successResponse({ webhooks: result.rows });
}

async function getWebhookDetails(
  webhookId: string,
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  // Verify user has access to this webhook
  const webhookCheck = await dbPool.query(
    `
    SELECT w.id, w.workspace_id, w.secret_token, w.signing_secret
    FROM webhooks w
    JOIN workspace_members wm ON w.workspace_id = wm.workspace_id
    WHERE w.id = $1 AND wm.user_id = $2 AND wm.is_deactivated = false
  `,
    [webhookId, userId],
  );

  if (webhookCheck.rows.length === 0) {
    return errorResponse('Webhook not found or access denied', 404);
  }

  const webhook = webhookCheck.rows[0];
  const url = `${webhookApiUrl}/${webhookId}`;

  return successResponse({
    id: webhook.id,
    url,
    secret_token: webhook.secret_token,
    signing_secret: webhook.signing_secret,
  });
}

async function updateWebhook(
  webhookId: string,
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  let body: any;
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Verify user has access to this webhook
  const webhookCheck = await dbPool.query(
    `
    SELECT w.id, w.workspace_id
    FROM webhooks w
    JOIN workspace_members wm ON w.workspace_id = wm.workspace_id
    WHERE w.id = $1 AND wm.user_id = $2 AND wm.is_deactivated = false
  `,
    [webhookId, userId],
  );

  if (webhookCheck.rows.length === 0) {
    return errorResponse('Webhook not found or access denied', 404);
  }

  const updateFields: string[] = [];
  const updateValues: any[] = [];
  let paramCount = 1;

  if (body.name !== undefined) {
    updateFields.push(`name = $${paramCount++}`);
    updateValues.push(body.name);
  }

  if (body.is_active !== undefined) {
    updateFields.push(`is_active = $${paramCount++}`);
    updateValues.push(!!body.is_active);
  }

  if (updateFields.length === 0) {
    return errorResponse('No valid fields to update', 400);
  }

  updateFields.push(`updated_at = now()`);
  updateValues.push(webhookId);

  const result = await dbPool.query(
    `
    UPDATE webhooks
    SET ${updateFields.join(', ')}
    WHERE id = $${paramCount}
    RETURNING id, name, is_active, last_used_at, created_at
  `,
    updateValues,
  );

  if (result.rows.length === 0) {
    return errorResponse('Webhook not found', 404);
  }

  return successResponse(result.rows[0]);
}

async function deleteWebhook(webhookId: string, userId: string): Promise<APIGatewayProxyResult> {
  // Verify user has access to this webhook
  const webhookCheck = await dbPool.query(
    `
    SELECT w.id, w.workspace_id
    FROM webhooks w
    JOIN workspace_members wm ON w.workspace_id = wm.workspace_id
    WHERE w.id = $1 AND wm.user_id = $2 AND wm.is_deactivated = false
  `,
    [webhookId, userId],
  );

  if (webhookCheck.rows.length === 0) {
    return errorResponse('Webhook not found or access denied', 404);
  }

  // Delete webhook usage records first (foreign key constraint)
  await dbPool.query('DELETE FROM webhook_usage WHERE webhook_id = $1', [webhookId]);

  // Delete the webhook
  const result = await dbPool.query('DELETE FROM webhooks WHERE id = $1 RETURNING id', [webhookId]);

  if (result.rows.length === 0) {
    return errorResponse('Webhook not found', 404);
  }

  return successResponse({ message: 'Webhook deleted successfully' });
}
