import { SQS } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import crypto from 'crypto';
import dbPool from '../../../common/utils/create-db-pool';

const sqs = new SQS({ region: process.env.AWS_REGION || 'us-east-2' });

interface LinearWebhookPayload {
  action: string;
  type: string;
  data: {
    id: string;
    title?: string;
    description?: string;
    url?: string;
    identifier?: string;
    state?: {
      id: string;
      name: string;
      type: string;
    };
    assignee?: {
      id: string;
      name: string;
      email: string;
    };
    creator?: {
      id: string;
      name: string;
      email: string;
    };
    team?: {
      id: string;
      name: string;
      key: string;
    };
    project?: {
      id: string;
      name: string;
    };
    priority?: number;
    estimate?: number;
    labels?: Array<{
      id: string;
      name: string;
      color: string;
    }>;
  };
  updatedFrom?: {
    assigneeId?: string;
    stateId?: string;
    priority?: number;
  };
  createdAt: string;
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
      !verifyLinearSignature(
        event.body || '',
        event.headers['linear-signature'],
        webhook.signing_secret,
      )
    ) {
      return errorResponse(401, 'Invalid signature', requestId);
    }

    const canProceed = await checkRateLimit(webhookId);
    if (!canProceed) {
      return errorResponse(429, 'Rate limit exceeded', requestId);
    }

    const linearPayload: LinearWebhookPayload = JSON.parse(event.body || '{}');

    const formattedPayload = formatLinearEvent(linearPayload);
    if (!formattedPayload) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Event ignored' }) };
    }

    const queueMessage: QueuedMessage = {
      webhookId,
      workspaceId: webhook.workspace_id,
      channelId: webhook.channel_id,
      payload: formattedPayload,
      requestId,
      authenticatedUser: 'linear-webhook',
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
    console.error('Linear webhook handler error:', error);
    return errorResponse(500, 'Internal server error', requestId);
  }
};

function formatLinearEvent(payload: LinearWebhookPayload) {
  const { action, type, data } = payload;

  const getEventColor = () => {
    switch (action) {
      case 'create':
        return '#5E6AD2';
      case 'update':
        return '#F2994A';
      case 'remove':
        return '#EB5757';
      default:
        return '#5E6AD2';
    }
  };

  const getPriorityText = (priority?: number) => {
    if (!priority) return 'No priority';
    switch (priority) {
      case 1:
        return 'Urgent';
      case 2:
        return 'High';
      case 3:
        return 'Medium';
      case 4:
        return 'Low';
      default:
        return 'No priority';
    }
  };

  switch (type) {
    case 'Issue':
      const fields = [];

      if (data.assignee) {
        fields.push({
          title: 'Assignee',
          value: data.assignee.name,
          short: true,
        });
      }

      if (data.state) {
        fields.push({
          title: 'Status',
          value: data.state.name,
          short: true,
        });
      }

      if (data.priority) {
        fields.push({
          title: 'Priority',
          value: getPriorityText(data.priority),
          short: true,
        });
      }

      if (data.team) {
        fields.push({
          title: 'Team',
          value: data.team.name,
          short: true,
        });
      }

      if (data.labels && data.labels.length > 0) {
        fields.push({
          title: 'Labels',
          value: data.labels.map((label) => label.name).join(', '),
          short: false,
        });
      }

      let issueText = '';
      if (action === 'create') {
        issueText = `Created by ${data.creator?.name || 'Unknown'}`;
      } else if (action === 'update') {
        const changes = [];
        if (payload.updatedFrom?.assigneeId) {
          changes.push(`assigned to ${data.assignee?.name || 'Unassigned'}`);
        }
        if (payload.updatedFrom?.stateId) {
          changes.push(`moved to ${data.state?.name}`);
        }
        if (payload.updatedFrom?.priority !== undefined) {
          changes.push(`priority changed to ${getPriorityText(data.priority)}`);
        }
        issueText = changes.length > 0 ? changes.join(', ') : 'Updated';
      }

      return {
        text: `Issue ${action}d: ${data.identifier} ${data.title}`,
        username: 'Linear',
        icon_url: 'https://linear.app/favicon.ico',
        attachments: [
          {
            color: getEventColor(),
            title: `${data.identifier}: ${data.title}`,
            text: issueText,
            fields: fields,
          },
        ],
      };

    case 'Comment':
      return {
        text: `Comment ${action}d`,
        username: 'Linear',
        icon_url: 'https://linear.app/favicon.ico',
        attachments: [
          {
            color: getEventColor(),
            title: `Comment ${action}d on issue`,
            text: `${data.creator?.name} ${action}d a comment`,
            fields: [
              {
                title: 'Issue',
                value: data.title || 'Unknown issue',
                short: true,
              },
            ],
          },
        ],
      };

    case 'Project':
      return {
        text: `Project ${action}d`,
        username: 'Linear',
        icon_url: 'https://linear.app/favicon.ico',
        attachments: [
          {
            color: getEventColor(),
            title: `Project: ${data.title}`,
            text: `Project ${action}d${data.creator ? ` by ${data.creator.name}` : ''}`,
            fields: data.team
              ? [
                  {
                    title: 'Team',
                    value: data.team.name,
                    short: true,
                  },
                ]
              : [],
          },
        ],
      };

    case 'Cycle':
      return {
        text: `Cycle ${action}d`,
        username: 'Linear',
        icon_url: 'https://linear.app/favicon.ico',
        attachments: [
          {
            color: getEventColor(),
            title: `Cycle: ${data.title}`,
            text: `Cycle ${action}d${data.creator ? ` by ${data.creator.name}` : ''}`,
            fields: data.team
              ? [
                  {
                    title: 'Team',
                    value: data.team.name,
                    short: true,
                  },
                ]
              : [],
          },
        ],
      };

    default:
      return null;
  }
}

function verifyLinearSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(body);
  const expectedSignature = hmac.digest('hex');

  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}

async function getWebhook(webhookId: string) {
  const result = await dbPool.query(
    `SELECT id, workspace_id, channel_id, signing_secret, is_active
     FROM webhooks
     WHERE id = $1 AND is_active = true AND source_type = 'linear'`,
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
  return parseInt(result.rows[0].count) < 15;
}

async function updateWebhookUsage(webhookId: string, sourceIp: string, userAgent?: string) {
  await Promise.all([
    dbPool.query(
      'INSERT INTO webhook_usage (webhook_id, source_ip, user_agent, authenticated_user) VALUES ($1, $2, $3, $4)',
      [webhookId, sourceIp, userAgent, 'linear-webhook'],
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
