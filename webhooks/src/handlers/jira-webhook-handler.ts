import { SQS } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import crypto from 'crypto';
import dbPool from '../../../common/utils/create-db-pool';

const sqs = new SQS({ region: process.env.AWS_REGION || 'us-east-2' });

interface JiraWebhookPayload {
  webhookEvent: string;
  issue?: {
    id: string;
    key: string;
    self: string;
    fields: {
      summary: string;
      description?: string;
      status: {
        name: string;
        statusCategory: {
          colorName: string;
        };
      };
      assignee?: {
        displayName: string;
        emailAddress: string;
        avatarUrls: {
          '48x48': string;
        };
      };
      reporter: {
        displayName: string;
        emailAddress: string;
      };
      priority?: {
        name: string;
        iconUrl: string;
      };
      issuetype: {
        name: string;
        iconUrl: string;
      };
      project: {
        key: string;
        name: string;
      };
      labels: string[];
      components: Array<{
        name: string;
      }>;
    };
  };
  comment?: {
    id: string;
    body: string;
    author: {
      displayName: string;
      emailAddress: string;
    };
    created: string;
    updated: string;
  };
  changelog?: {
    items: Array<{
      field: string;
      fieldtype: string;
      from: string;
      fromString: string;
      to: string;
      toString: string;
    }>;
  };
  user: {
    displayName: string;
    emailAddress: string;
  };
  timestamp: number;
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

    if (webhook.signing_secret) {
      const tokenHeader = event.headers['authorization'];
      if (!verifyJiraToken(tokenHeader, webhook.signing_secret)) {
        return errorResponse(401, 'Invalid authorization token', requestId);
      }
    }

    const canProceed = await checkRateLimit(webhookId);
    if (!canProceed) {
      return errorResponse(429, 'Rate limit exceeded', requestId);
    }

    const jiraPayload: JiraWebhookPayload = JSON.parse(event.body || '{}');

    const formattedPayload = formatJiraEvent(jiraPayload);
    if (!formattedPayload) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Event ignored' }) };
    }

    const queueMessage: QueuedMessage = {
      webhookId,
      workspaceId: webhook.workspace_id,
      channelId: webhook.channel_id,
      payload: formattedPayload,
      requestId,
      authenticatedUser: 'jira-webhook',
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
    console.error('Jira webhook handler error:', error);
    return errorResponse(500, 'Internal server error', requestId);
  }
};

function formatJiraEvent(payload: JiraWebhookPayload) {
  const { webhookEvent, issue, comment, changelog, user } = payload;

  const getStatusColor = (colorName: string) => {
    switch (colorName.toLowerCase()) {
      case 'blue-gray':
        return '#42526E';
      case 'yellow':
        return '#FFAB00';
      case 'green':
        return '#36B37E';
      case 'red':
        return '#DE350B';
      case 'purple':
        return '#6554C0';
      case 'blue':
        return '#0052CC';
      default:
        return '#42526E';
    }
  };

  const getEventColor = (eventType: string) => {
    switch (eventType) {
      case 'jira:issue_created':
        return '#36B37E';
      case 'jira:issue_updated':
        return '#FFAB00';
      case 'jira:issue_deleted':
        return '#DE350B';
      case 'comment_created':
        return '#0052CC';
      default:
        return '#42526E';
    }
  };

  switch (webhookEvent) {
    case 'jira:issue_created':
      if (!issue) return null;

      const fields = [
        {
          title: 'Type',
          value: issue.fields.issuetype.name,
          short: true,
        },
        {
          title: 'Status',
          value: issue.fields.status.name,
          short: true,
        },
      ];

      if (issue.fields.assignee) {
        fields.push({
          title: 'Assignee',
          value: issue.fields.assignee.displayName,
          short: true,
        });
      }

      if (issue.fields.priority) {
        fields.push({
          title: 'Priority',
          value: issue.fields.priority.name,
          short: true,
        });
      }

      if (issue.fields.components.length > 0) {
        fields.push({
          title: 'Components',
          value: issue.fields.components.map((c) => c.name).join(', '),
          short: false,
        });
      }

      if (issue.fields.labels.length > 0) {
        fields.push({
          title: 'Labels',
          value: issue.fields.labels.join(', '),
          short: false,
        });
      }

      return {
        text: `Issue created: ${issue.key}`,
        username: 'Jira',
        icon_url: 'https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon-32x32.png',
        attachments: [
          {
            color: getEventColor(webhookEvent),
            title: `${issue.key}: ${issue.fields.summary}`,
            text: `Created by ${issue.fields.reporter.displayName}`,
            fields: fields,
          },
        ],
      };

    case 'jira:issue_updated':
      if (!issue || !changelog) return null;

      const changes = changelog.items.map((item) => {
        switch (item.field) {
          case 'status':
            return `Status: ${item.fromString} → ${item.toString}`;
          case 'assignee':
            const fromAssignee = item.fromString || 'Unassigned';
            const toAssignee = item.toString || 'Unassigned';
            return `Assignee: ${fromAssignee} → ${toAssignee}`;
          case 'priority':
            return `Priority: ${item.fromString} → ${item.toString}`;
          case 'summary':
            return `Summary updated`;
          case 'description':
            return `Description updated`;
          case 'labels':
            return `Labels updated`;
          case 'components':
            return `Components updated`;
          default:
            return `${item.field}: ${item.fromString || 'None'} → ${item.toString || 'None'}`;
        }
      });

      const updateFields = [
        {
          title: 'Updated by',
          value: user.displayName,
          short: true,
        },
        {
          title: 'Current Status',
          value: issue.fields.status.name,
          short: true,
        },
      ];

      if (issue.fields.assignee) {
        updateFields.push({
          title: 'Assignee',
          value: issue.fields.assignee.displayName,
          short: true,
        });
      }

      return {
        text: `Issue updated: ${issue.key}`,
        username: 'Jira',
        icon_url: 'https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon-32x32.png',
        attachments: [
          {
            color: getStatusColor(issue.fields.status.statusCategory.colorName),
            title: `${issue.key}: ${issue.fields.summary}`,
            text: changes.join('\n'),
            fields: updateFields,
          },
        ],
      };

    case 'comment_created':
    case 'comment_updated':
      if (!issue || !comment) return null;

      const commentAction = webhookEvent === 'comment_created' ? 'added' : 'updated';
      const commentText =
        comment.body.length > 200 ? comment.body.substring(0, 200) + '...' : comment.body;

      return {
        text: `Comment ${commentAction} on ${issue.key}`,
        username: 'Jira',
        icon_url: 'https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon-32x32.png',
        attachments: [
          {
            color: getEventColor(webhookEvent),
            title: `${issue.key}: ${issue.fields.summary}`,
            text: commentText,
            fields: [
              {
                title: `Comment ${commentAction} by`,
                value: comment.author.displayName,
                short: true,
              },
              {
                title: 'Issue Status',
                value: issue.fields.status.name,
                short: true,
              },
            ],
          },
        ],
      };

    case 'jira:issue_deleted':
      if (!issue) return null;

      return {
        text: `Issue deleted: ${issue.key}`,
        username: 'Jira',
        icon_url: 'https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon-32x32.png',
        attachments: [
          {
            color: getEventColor(webhookEvent),
            title: `${issue.key}: ${issue.fields.summary}`,
            text: `Deleted by ${user.displayName}`,
            fields: [
              {
                title: 'Project',
                value: issue.fields.project.name,
                short: true,
              },
              {
                title: 'Type',
                value: issue.fields.issuetype.name,
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

function verifyJiraToken(authHeader: string | undefined, expectedToken: string): boolean {
  if (!authHeader) return false;

  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expectedToken));
  }

  return crypto.timingSafeEqual(Buffer.from(authHeader), Buffer.from(expectedToken));
}

async function getWebhook(webhookId: string) {
  const result = await dbPool.query(
    `SELECT id, workspace_id, channel_id, signing_secret, is_active
     FROM webhooks
     WHERE id = $1 AND is_active = true AND source_type = 'jira'`,
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
  return parseInt(result.rows[0].count) < 20;
}

async function updateWebhookUsage(webhookId: string, sourceIp: string, userAgent?: string) {
  await Promise.all([
    dbPool.query(
      'INSERT INTO webhook_usage (webhook_id, source_ip, user_agent, authenticated_user) VALUES ($1, $2, $3, $4)',
      [webhookId, sourceIp, userAgent, 'jira-webhook'],
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
