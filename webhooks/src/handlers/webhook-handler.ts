import { SQS } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import crypto from 'crypto';
import dbPool from '../../../common/utils/create-db-pool';

const sqs = new SQS({ region: process.env.AWS_REGION || 'us-east-2' });

interface WebhookPayload {
  channel_id: string;
  text: string;
  markdown?: string;
  attachments?: Array<{
    color?: string;
    title?: string;
    text?: string;
    fields?: Array<{ title: string; value: string; short?: boolean }>;
  }>;
  username?: string;
  icon_url?: string;
}

interface QueuedMessage {
  webhookId: string;
  workspaceId: string;
  channelId: string;
  payload: Omit<WebhookPayload, 'channel_id'>;
  requestId: string;
  authenticatedUser?: string;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requestId = crypto.randomUUID();

  try {
    const webhookId = event.pathParameters?.webhookId;
    if (!webhookId) {
      return errorResponse(400, 'Webhook ID required', requestId);
    }

    const webhook = await getWebhook(webhookId);
    if (!webhook) {
      return errorResponse(404, 'Webhook not found', requestId);
    }

    const signature = event.headers['x-pager-signature'];
    const timestamp = event.headers['x-pager-request-timestamp'];
    const userAgent = event.headers['user-agent'];

    if (!signature || !timestamp) {
      await logUnauthorizedAttempt(
        webhookId,
        event.requestContext.http.sourceIp,
        userAgent,
        'Missing signature or timestamp',
      );
      return errorResponse(
        401,
        'Authentication required: Missing signature or timestamp headers',
        requestId,
      );
    }

    const signatureVerification = verifySignature(
      event.body || '',
      signature,
      timestamp,
      webhook.signing_secret,
    );
    if (!signatureVerification.valid) {
      await logUnauthorizedAttempt(
        webhookId,
        event.requestContext.http.sourceIp,
        userAgent,
        signatureVerification.reason,
      );
      return errorResponse(
        401,
        `Authentication failed: ${signatureVerification.reason}`,
        requestId,
      );
    }

    const canProceed = await checkSimpleRateLimit(webhookId);
    if (!canProceed) {
      await logUnauthorizedAttempt(
        webhookId,
        event.requestContext.http.sourceIp,
        userAgent,
        'Rate limit exceeded',
      );
      return errorResponse(429, 'Rate limit exceeded', requestId);
    }

    const payload: WebhookPayload = JSON.parse(event.body || '{}');

    if (!payload.text && !payload.markdown) {
      return errorResponse(400, 'Message must contain text or markdown', requestId);
    }

    if (!payload.channel_id) {
      return errorResponse(400, 'channel_id is required', requestId);
    }

    const channelExists = await verifyChannel(payload.channel_id, webhook.workspace_id);
    if (!channelExists) {
      return errorResponse(400, 'Invalid channel_id for this workspace', requestId);
    }

    const { channel_id, ...cleanPayload } = payload;

    const queueMessage: QueuedMessage = {
      webhookId,
      workspaceId: webhook.workspace_id,
      channelId: channel_id,
      payload: cleanPayload,
      requestId,
      authenticatedUser: event.headers['x-pager-user-id'] || 'webhook-authenticated',
    };

    await sqs.sendMessage({
      QueueUrl: process.env.WEBHOOK_QUEUE_URL!,
      MessageBody: JSON.stringify(queueMessage),
      MessageGroupId: webhookId,
    });

    await Promise.all([
      dbPool.query(
        'INSERT INTO webhook_usage (webhook_id, source_ip, user_agent, authenticated_user) VALUES ($1, $2, $3, $4)',
        [webhookId, event.requestContext.http.sourceIp, userAgent, queueMessage.authenticatedUser],
      ),
      dbPool.query('UPDATE webhooks SET last_used_at = now() WHERE id = $1', [webhookId]),
    ]);

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        success: true,
        request_id: requestId,
        channel_id: channel_id,
      }),
    };
  } catch (error) {
    console.error('Webhook handler error:', error);
    return errorResponse(500, 'Internal server error', requestId);
  }
};

async function getWebhook(webhookId: string) {
  const result = await dbPool.query(
    `
    SELECT id, workspace_id, signing_secret, is_active
    FROM webhooks
    WHERE id = $1 AND is_active = true
  `,
    [webhookId],
  );

  return result.rows[0] || null;
}

async function verifyChannel(channelId: string, workspaceId: string): Promise<boolean> {
  const result = await dbPool.query(
    `
    SELECT id FROM channels
    WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
  `,
    [channelId, workspaceId],
  );

  return result.rows.length > 0;
}

interface SignatureVerification {
  valid: boolean;
  reason?: string;
}

function verifySignature(
  body: string,
  signature: string,
  timestamp: string,
  secret: string,
): SignatureVerification {
  const now = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp);

  if (isNaN(requestTime)) {
    return { valid: false, reason: 'Invalid timestamp format' };
  }

  if (Math.abs(now - requestTime) > 300) {
    return { valid: false, reason: 'Request timestamp too old (>5 minutes)' };
  }

  if (!signature.startsWith('v0=')) {
    return { valid: false, reason: 'Invalid signature format' };
  }

  const baseString = `v0:${timestamp}:${body}`;
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(baseString);
  const expectedSignature = `v0=${hmac.digest('hex')}`;

  const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));

  return isValid ? { valid: true } : { valid: false, reason: 'Signature mismatch' };
}

async function checkSimpleRateLimit(webhookId: string): Promise<boolean> {
  const result = await dbPool.query(
    `
    SELECT COUNT(*) as count
    FROM webhook_usage
    WHERE webhook_id = $1 AND created_at > now() - INTERVAL '1 second'
  `,
    [webhookId],
  );

  return parseInt(result.rows[0].count) === 0;
}

async function logUnauthorizedAttempt(
  webhookId: string,
  sourceIp: string,
  userAgent?: string,
  reason?: string,
): Promise<void> {
  try {
    await dbPool.query(
      `INSERT INTO webhook_unauthorized_attempts
       (webhook_id, source_ip, user_agent, failure_reason, attempted_at)
       VALUES ($1, $2, $3, $4, now())`,
      [webhookId, sourceIp, userAgent, reason],
    );
  } catch (error) {
    console.error('Failed to log unauthorized attempt:', error);
  }
}

function errorResponse(
  statusCode: number,
  message: string,
  requestId: string,
): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error: message, request_id: requestId }),
  };
}
