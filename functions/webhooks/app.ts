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

const ALLOWED_SOURCE_TYPES = ['custom', 'github', 'linear', 'jira', 'stripe'] as const;
type SourceType = (typeof ALLOWED_SOURCE_TYPES)[number];

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

  const { workspace_id, name, source_type = 'custom', channel_id, signing_secret } = body;

  if (!workspace_id || !name) {
    return errorResponse('workspace_id and name are required', 400);
  }

  if (!ALLOWED_SOURCE_TYPES.includes(source_type)) {
    return errorResponse(
      'Invalid source_type. Must be one of: custom, github, linear, jira, stripe',
      400,
    );
  }

  // Verify user is an admin of the workspace
  const adminCheck = await dbPool.query(
    `
    SELECT wm.role FROM workspace_members wm
    WHERE wm.workspace_id = $1 AND wm.user_id = $2 AND wm.is_deactivated = false
  `,
    [workspace_id, userId],
  );

  if (adminCheck.rows.length === 0) {
    return errorResponse('User is not a member of this workspace', 403);
  }

  if (adminCheck.rows[0].role !== 'admin') {
    return errorResponse('Only workspace admins can create webhooks', 403);
  }

  // Validate channel_id requirements
  if (source_type !== 'custom') {
    if (!channel_id) {
      return errorResponse('channel_id is required for service webhooks', 400);
    }

    // Verify channel exists in workspace
    const channelCheck = await dbPool.query(
      `SELECT id FROM channels WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [channel_id, workspace_id],
    );

    if (channelCheck.rows.length === 0) {
      return errorResponse('Invalid channel_id for this workspace', 400);
    }
  } else if (channel_id) {
    return errorResponse('Custom webhooks cannot have a pre-set channel_id', 400);
  }

  // Validate signing_secret requirements
  if (source_type !== 'custom') {
    if (!signing_secret && source_type !== 'stripe') {
      return errorResponse('signing_secret is required for service webhooks', 400);
    }

    // Only validate signing_secret format if it's provided
    if (
      signing_secret &&
      (typeof signing_secret !== 'string' || signing_secret.trim().length === 0)
    ) {
      return errorResponse('signing_secret must be a non-empty string', 400);
    }

    // Stripe-specific validation for webhook endpoint secret
    if (source_type === 'stripe') {
      if (signing_secret && !signing_secret.startsWith('whsec_')) {
        return errorResponse(
          'Stripe signing_secret must be a webhook endpoint secret starting with "whsec_"',
          400,
        );
      }
    }
  }

  // Check service webhook limits
  if (source_type !== 'custom') {
    const existingServiceWebhook = await dbPool.query(
      `SELECT id FROM webhooks WHERE workspace_id = $1 AND source_type = $2`,
      [workspace_id, source_type],
    );

    if (existingServiceWebhook.rows.length > 5) {
      return errorResponse(`Only 5 ${source_type} webhooks are allowed per workspace`, 409);
    }
  } else {
    // Check custom webhook limits (max 5)
    const existingCustomWebhooks = await dbPool.query(
      `SELECT COUNT(*) as count FROM webhooks WHERE workspace_id = $1 AND source_type = 'custom'`,
      [workspace_id],
    );

    if (parseInt(existingCustomWebhooks.rows[0].count) >= 5) {
      return errorResponse('Maximum of 5 custom webhooks allowed per workspace', 409);
    }
  }

  // Handle secrets based on webhook type
  let finalSecretToken: string;
  let finalSigningSecret: string | null;

  if (source_type === 'custom') {
    // For custom webhooks, generate both secrets
    finalSecretToken = crypto.randomBytes(32).toString('hex');
    finalSigningSecret = crypto.randomBytes(32).toString('hex');
  } else {
    // For service webhooks, use provided signing_secret and generate a secret_token for our own use
    finalSecretToken = crypto.randomBytes(32).toString('hex');
    finalSigningSecret = signing_secret ? signing_secret.trim() : null;
  }

  const result = await dbPool.query(
    `
    INSERT INTO webhooks (workspace_id, name, source_type, channel_id, secret_token, signing_secret, created_by_user_id)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `,
    [workspace_id, name, source_type, channel_id, finalSecretToken, finalSigningSecret, userId],
  );

  const newWebhookId = result.rows[0].id;

  // Generate the appropriate URL based on source type
  const url = `${webhookApiUrl}/${source_type}/${newWebhookId}`;

  return successResponse(
    {
      id: newWebhookId,
      url,
      source_type,
      channel_id,
      secret_token: finalSecretToken,
      signing_secret: finalSigningSecret,
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
      w.source_type,
      w.channel_id,
      w.is_active,
      w.last_used_at,
      w.last_message_at,
      w.message_count,
      w.created_at,
      w.signing_secret,
      u.name as created_by_name,
      c.name as channel_name,
      COUNT(wu.id) as total_requests
    FROM webhooks w
    LEFT JOIN users u ON w.created_by_user_id = u.id
    LEFT JOIN channels c ON w.channel_id = c.id
    LEFT JOIN webhook_usage wu ON w.id = wu.webhook_id
    WHERE w.workspace_id = $1
    GROUP BY w.id, w.name, w.source_type, w.channel_id, w.is_active, w.last_used_at, w.last_message_at, w.message_count, w.created_at, w.signing_secret, u.name, c.name
    ORDER BY w.created_at DESC
  `,
    [workspaceId],
  );

  // Add webhook URLs to each webhook
  const webhooksWithUrls = result.rows.map((webhook) => ({
    ...webhook,
    url: `${webhookApiUrl}/${webhook.source_type}/${webhook.id}`,
    total_requests: parseInt(webhook.total_requests) || 0,
  }));

  return successResponse({ webhooks: webhooksWithUrls });
}

async function getWebhookDetails(
  webhookId: string,
  event: APIGatewayProxyEvent,
  userId: string,
): Promise<APIGatewayProxyResult> {
  // Verify user has access to this webhook
  const webhookCheck = await dbPool.query(
    `
    SELECT w.id, w.workspace_id, w.source_type, w.channel_id, w.secret_token, w.signing_secret
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
  const url = `${webhookApiUrl}/${webhook.source_type}/${webhook.id}`;

  return successResponse({
    id: webhook.id,
    url,
    source_type: webhook.source_type,
    channel_id: webhook.channel_id,
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

  // Verify user has permission to edit this webhook (creator or admin)
  const webhookCheck = await dbPool.query(
    `
    SELECT w.id, w.workspace_id, w.source_type, w.created_by_user_id, wm.role
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
  const isCreator = webhook.created_by_user_id === userId;
  const isAdmin = webhook.role === 'admin';

  if (!isCreator && !isAdmin) {
    return errorResponse('Only the webhook creator or workspace admin can edit webhooks', 403);
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

  if (body.channel_id !== undefined) {
    // Validate channel change rules
    if (webhook.source_type === 'custom' && body.channel_id !== null) {
      return errorResponse('Custom webhooks cannot have a pre-set channel_id', 400);
    }

    if (webhook.source_type !== 'custom' && !body.channel_id) {
      return errorResponse('Service webhooks must have a channel_id', 400);
    }

    if (body.channel_id) {
      // Verify channel exists in workspace
      const channelCheck = await dbPool.query(
        `SELECT id FROM channels WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
        [body.channel_id, webhook.workspace_id],
      );

      if (channelCheck.rows.length === 0) {
        return errorResponse('Invalid channel_id for this workspace', 400);
      }
    }

    updateFields.push(`channel_id = $${paramCount++}`);
    updateValues.push(body.channel_id);
  }

  if (body.signing_secret !== undefined) {
    // Validate Stripe signing secret format if being updated
    if (
      webhook.source_type === 'stripe' &&
      body.signing_secret &&
      !body.signing_secret.startsWith('whsec_')
    ) {
      return errorResponse(
        'Stripe signing_secret must be a webhook endpoint secret starting with "whsec_"',
        400,
      );
    }

    updateFields.push(`signing_secret = $${paramCount++}`);
    updateValues.push(body.signing_secret);
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
    RETURNING id, name, source_type, channel_id, is_active, last_used_at, last_message_at,
              message_count, created_at, updated_at, secret_token, signing_secret, created_by_user_id
  `,
    updateValues,
  );

  if (result.rows.length === 0) {
    return errorResponse('Webhook not found', 404);
  }

  const updatedWebhook = result.rows[0];

  // Get additional info for complete response
  const detailsResult = await dbPool.query(
    `
    SELECT
      u.name as created_by_name,
      c.name as channel_name,
      COUNT(wu.id) as total_requests
    FROM webhooks w
    LEFT JOIN users u ON w.created_by_user_id = u.id
    LEFT JOIN channels c ON w.channel_id = c.id
    LEFT JOIN webhook_usage wu ON w.id = wu.webhook_id
    WHERE w.id = $1
    GROUP BY u.name, c.name
  `,
    [webhookId],
  );

  const details = detailsResult.rows[0] || {
    created_by_name: null,
    channel_name: null,
    total_requests: 0,
  };

  // Generate the webhook URL
  const url = `${webhookApiUrl}/${updatedWebhook.source_type}/${updatedWebhook.id}`;

  return successResponse({
    ...updatedWebhook,
    url,
    created_by_name: details.created_by_name,
    channel_name: details.channel_name,
    total_requests: parseInt(details.total_requests) || 0,
  });
}

async function deleteWebhook(webhookId: string, userId: string): Promise<APIGatewayProxyResult> {
  // Verify user has permission to delete this webhook (creator or admin)
  const webhookCheck = await dbPool.query(
    `
    SELECT w.id, w.workspace_id, w.created_by_user_id, wm.role
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
  const isCreator = webhook.created_by_user_id === userId;
  const isAdmin = webhook.role === 'admin';

  if (!isCreator && !isAdmin) {
    return errorResponse('Only the webhook creator or workspace admin can delete webhooks', 403);
  }

  // Delete webhook usage records first (foreign key constraint)
  await dbPool.query('DELETE FROM webhook_usage WHERE webhook_id = $1', [webhookId]);
  await dbPool.query('DELETE FROM webhook_unauthorized_attempts WHERE webhook_id = $1', [
    webhookId,
  ]);
  await dbPool.query('DELETE FROM webhook_processing_errors WHERE webhook_id = $1', [webhookId]);

  // Delete the webhook
  const result = await dbPool.query('DELETE FROM webhooks WHERE id = $1 RETURNING id', [webhookId]);

  if (result.rows.length === 0) {
    return errorResponse('Webhook not found', 404);
  }

  return successResponse({ message: 'Webhook deleted successfully' });
}
