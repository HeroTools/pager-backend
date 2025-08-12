import { SQS } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import crypto from 'crypto';
import dbPool from '../../../common/utils/create-db-pool';

const sqs = new SQS({ region: process.env.AWS_REGION || 'us-east-2' });

interface GitHubWebhookPayload {
  action?: string;
  repository: {
    name: string;
    full_name: string;
    html_url: string;
  };
  sender: {
    login: string;
    avatar_url: string;
  };
  pull_request?: {
    title: string;
    html_url: string;
    number: number;
    state: string;
  };
  issue?: {
    title: string;
    html_url: string;
    number: number;
    state: string;
  };
  commits?: Array<{
    message: string;
    author: { name: string };
    url: string;
  }>;
}

interface QueuedMessage {
  webhookId: string;
  workspaceId: string;
  channelId: string;
  payload: {
    text: string;
    markdown?: string;
    username?: string;
    icon_url?: string;
    attachments?: Array<{
      color?: string;
      title?: string;
      text?: string;
      fields?: Array<{ title: string; value: string; short?: boolean }>;
    }>;
  };
  requestId: string;
  authenticatedUser: string;
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

    if (
      !verifyGitHubSignature(
        event.body || '',
        event.headers['x-hub-signature-256'],
        webhook.signing_secret,
      )
    ) {
      return errorResponse(401, 'Invalid signature', requestId);
    }

    const canProceed = await checkRateLimit(webhookId);
    if (!canProceed) {
      return errorResponse(429, 'Rate limit exceeded', requestId);
    }

    const githubPayload: GitHubWebhookPayload = JSON.parse(event.body || '{}');
    const eventType = event.headers['x-github-event'];

    if (!eventType) {
      return errorResponse(400, 'Missing GitHub event type', requestId);
    }

    const formattedPayload = formatGitHubEvent(githubPayload, eventType);
    if (!formattedPayload) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Event ignored' }) };
    }

    const queueMessage: QueuedMessage = {
      webhookId,
      workspaceId: webhook.workspace_id,
      channelId: webhook.channel_id,
      payload: formattedPayload,
      requestId,
      authenticatedUser: 'github-webhook',
    };

    await sqs.sendMessage({
      QueueUrl: process.env.WEBHOOK_QUEUE_URL!,
      MessageBody: JSON.stringify(queueMessage),
      MessageGroupId: webhookId,
    });

    await updateWebhookUsage(
      webhookId,
      event.requestContext.http.sourceIp,
      event.headers['user-agent'],
    );

    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ success: true, request_id: requestId }),
    };
  } catch (error) {
    console.error('GitHub webhook adapter error:', error);
    return errorResponse(500, 'Internal server error', requestId);
  }
};

function formatGitHubEvent(payload: GitHubWebhookPayload, eventType: string) {
  const { repository, sender } = payload;

  switch (eventType) {
    case 'push':
      return {
        text: `Push to ${repository.name}`,
        username: 'GitHub',
        icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
        attachments: [
          {
            color: '#0366d6',
            title: `${payload.commits?.length || 0} commits pushed to ${repository.full_name}`,
            text:
              payload.commits
                ?.map((commit) => `• ${commit.message.split('\n')[0]} - ${commit.author.name}`)
                .join('\n') || '',
            fields: [
              {
                title: 'Repository',
                value: `[${repository.full_name}](${repository.html_url})`,
                short: true,
              },
            ],
          },
        ],
      };

    case 'pull_request':
      const pr = payload.pull_request!;
      const action = payload.action;
      return {
        text: `Pull request ${action}`,
        username: 'GitHub',
        icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
        attachments: [
          {
            color: action === 'opened' ? '#28a745' : action === 'closed' ? '#6f42c1' : '#0366d6',
            title: `#${pr.number}: ${pr.title}`,
            text: `${action} by ${sender.login}`,
            fields: [
              {
                title: 'Repository',
                value: `[${repository.full_name}](${repository.html_url})`,
                short: true,
              },
              {
                title: 'Pull Request',
                value: `[#${pr.number}](${pr.html_url})`,
                short: true,
              },
            ],
          },
        ],
      };

    case 'issues':
      const issue = payload.issue!;
      return {
        text: `Issue ${payload.action}`,
        username: 'GitHub',
        icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
        attachments: [
          {
            color: payload.action === 'opened' ? '#d73a49' : '#6f42c1',
            title: `#${issue.number}: ${issue.title}`,
            text: `${payload.action} by ${sender.login}`,
            fields: [
              {
                title: 'Repository',
                value: `[${repository.full_name}](${repository.html_url})`,
                short: true,
              },
              {
                title: 'Issue',
                value: `[#${issue.number}](${issue.html_url})`,
                short: true,
              },
            ],
          },
        ],
      };

    default:
      return null;
  }
}

function verifyGitHubSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  const expectedSignature = `sha256=${hmac.digest('hex')}`;

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

async function getWebhook(webhookId: string) {
  const result = await dbPool.query(
    `SELECT id, workspace_id, channel_id, signing_secret, is_active
     FROM webhooks
     WHERE id = $1 AND is_active = true AND source_type = 'github'`,
    [webhookId],
  );
  return result.rows[0] || null;
}

async function checkRateLimit(webhookId: string): Promise<boolean> {
  const result = await dbPool.query(
    `SELECT COUNT(*) as count
     FROM webhook_usage
     WHERE webhook_id = $1 AND created_at > now() - INTERVAL '10 seconds'`,
    [webhookId],
  );
  return parseInt(result.rows[0].count) < 10;
}

async function updateWebhookUsage(webhookId: string, sourceIp: string, userAgent?: string) {
  await Promise.all([
    dbPool.query(
      'INSERT INTO webhook_usage (webhook_id, source_ip, user_agent, authenticated_user) VALUES ($1, $2, $3, $4)',
      [webhookId, sourceIp, userAgent, 'github-webhook'],
    ),
    dbPool.query('UPDATE webhooks SET last_used_at = now() WHERE id = $1', [webhookId]),
  ]);
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
