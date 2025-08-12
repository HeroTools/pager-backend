import { SQS } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import crypto from 'crypto';
import dbPool from '../../../common/utils/create-db-pool';
import { GitHubWebhookPayload, QueuedMessage, SlackMessage } from '../types';

const sqs = new SQS({ region: process.env.AWS_REGION || 'us-east-2' });

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

    if (!isValidGitHubEvent(eventType, githubPayload)) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Event ignored' }) };
    }

    const slackFormattedPayload = formatGitHubEvent(githubPayload, eventType);
    if (!slackFormattedPayload) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Event ignored' }) };
    }

    const queueMessage: QueuedMessage = {
      webhookId,
      workspaceId: webhook.workspace_id,
      channelId: webhook.channel_id,
      payload: slackFormattedPayload,
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
    console.error('GitHub webhook handler error:', error);
    return errorResponse(500, 'Internal server error', requestId);
  }
};

function isValidGitHubEvent(eventType: string, payload: GitHubWebhookPayload): boolean {
  if (!payload.repository || !payload.sender) {
    return false;
  }

  const supportedEvents = ['push', 'pull_request', 'issues', 'issue_comment', 'pull_request_review', 'release'];
  
  if (!supportedEvents.includes(eventType)) {
    return false;
  }

  if (eventType === 'pull_request' && !payload.pull_request) {
    return false;
  }

  if (eventType === 'issues' && !payload.issue) {
    return false;
  }

  if (eventType === 'issue_comment' && (!payload.comment || !payload.issue)) {
    return false;
  }

  if (eventType === 'release' && !payload.release) {
    return false;
  }

  return true;
}

function formatGitHubEvent(payload: GitHubWebhookPayload, eventType: string): SlackMessage | null {
  switch (eventType) {
    case 'push':
      return formatPushEvent(payload);
    case 'pull_request':
      return formatPullRequestEvent(payload);
    case 'issues':
      return formatIssueEvent(payload);
    case 'issue_comment':
      return formatIssueCommentEvent(payload);
    case 'pull_request_review':
      return formatPullRequestReviewEvent(payload);
    case 'release':
      return formatReleaseEvent(payload);
    default:
      return null;
  }
}

function formatPushEvent(payload: GitHubWebhookPayload): SlackMessage {
  const { repository, sender, commits, compare } = payload;
  const commitCount = commits?.length || 0;
  
  const headerText = `Push to ${repository.name}`;
  const mainText = `*${headerText}*\n${commitCount} commit${commitCount !== 1 ? 's' : ''} pushed to *<${repository.html_url}|${repository.full_name}>*`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  if (commits && commits.length > 0) {
    let commitMessages = commits
      .slice(0, 5)
      .map((commit) => `• <${commit.url}|${commit.id.substring(0, 7)}> ${truncateText(commit.message.split('\n')[0], 80)}`)
      .join('\n');

    if (commits.length > 5) {
      const remaining = commits.length - 5;
      commitMessages += `\n... and ${remaining} more commit${remaining !== 1 ? 's' : ''}`;
    }

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: commitMessages,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: buildContextLine(repository, sender),
      },
    ],
  });

  return {
    username: 'GitHub',
    icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    blocks,
  };
}

function formatPullRequestEvent(payload: GitHubWebhookPayload): SlackMessage {
  const { repository, sender, pull_request: pr, action } = payload;
  
  if (!pr) return null;

  const headerText = `Pull Request ${getActionText(action)}`;
  const mainText = `*${headerText}*\n*<${pr.html_url}|#${pr.number}>* ${pr.title}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  if (pr.body && action === 'opened') {
    const truncatedBody = truncateText(pr.body, 200);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncatedBody,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: buildPullRequestContextLine(repository, sender, pr),
      },
    ],
  });

  return {
    username: 'GitHub',
    icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    blocks,
  };
}

function formatIssueEvent(payload: GitHubWebhookPayload): SlackMessage {
  const { repository, sender, issue, action } = payload;
  
  if (!issue) return null;

  const headerText = `Issue ${getActionText(action)}`;
  const mainText = `*${headerText}*\n*<${issue.html_url}|#${issue.number}>* ${issue.title}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  if (issue.body && action === 'opened') {
    const truncatedBody = truncateText(issue.body, 200);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncatedBody,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: buildIssueContextLine(repository, sender, issue),
      },
    ],
  });

  return {
    username: 'GitHub',
    icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    blocks,
  };
}

function formatIssueCommentEvent(payload: GitHubWebhookPayload): SlackMessage {
  const { repository, sender, issue, comment, action } = payload;
  
  if (!issue || !comment) return null;

  const headerText = `Comment ${getActionText(action)} on Issue`;
  const mainText = `*${headerText}*\n*<${issue.html_url}|#${issue.number}>* ${issue.title}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  if (comment.body) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateText(comment.body, 200),
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: buildContextLine(repository, sender),
      },
    ],
  });

  return {
    username: 'GitHub',
    icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    blocks,
  };
}

function formatPullRequestReviewEvent(payload: GitHubWebhookPayload): SlackMessage {
  const { repository, sender, pull_request: pr, action } = payload;
  
  if (!pr) return null;

  const headerText = `Pull Request Review ${getActionText(action)}`;
  const mainText = `*${headerText}*\n*<${pr.html_url}|#${pr.number}>* ${pr.title}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: buildContextLine(repository, sender),
        },
      ],
    },
  ];

  return {
    username: 'GitHub',
    icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    blocks,
  };
}

function formatReleaseEvent(payload: GitHubWebhookPayload): SlackMessage {
  const { repository, sender, release, action } = payload;
  
  if (!release) return null;

  const headerText = `Release ${getActionText(action)}`;
  const mainText = `*${headerText}*\n*<${release.html_url}|${release.tag_name}>* ${release.name || release.tag_name}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  if (release.body && action === 'published') {
    const truncatedBody = truncateText(release.body, 200);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncatedBody,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: buildContextLine(repository, sender),
      },
    ],
  });

  return {
    username: 'GitHub',
    icon_url: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
    blocks,
  };
}

function buildContextLine(repository: GitHubWebhookPayload['repository'], sender: GitHubWebhookPayload['sender']): string {
  const parts = [];

  if (sender) {
    parts.push(sender.login);
  }

  parts.push(repository.full_name);
  parts.push(formatRelativeTime(new Date().toISOString()));

  return parts.join(' • ');
}

function buildPullRequestContextLine(
  repository: GitHubWebhookPayload['repository'],
  sender: GitHubWebhookPayload['sender'],
  pr: GitHubWebhookPayload['pull_request']
): string {
  const parts = [];

  if (sender) {
    parts.push(sender.login);
  }

  parts.push(`${pr.head.ref} → ${pr.base.ref}`);
  parts.push(repository.full_name);
  parts.push(formatRelativeTime(new Date().toISOString()));

  return parts.join(' • ');
}

function buildIssueContextLine(
  repository: GitHubWebhookPayload['repository'],
  sender: GitHubWebhookPayload['sender'],
  issue: GitHubWebhookPayload['issue']
): string {
  const parts = [];

  if (sender) {
    parts.push(sender.login);
  }

  if (issue.labels && issue.labels.length > 0) {
    const labelNames = issue.labels.map(label => label.name).slice(0, 3).join(', ');
    parts.push(`Labels: ${labelNames}`);
  }

  parts.push(repository.full_name);
  parts.push(formatRelativeTime(new Date().toISOString()));

  return parts.join(' • ');
}

function getActionText(action?: string): string {
  switch (action) {
    case 'opened':
      return 'opened';
    case 'closed':
      return 'closed';
    case 'reopened':
      return 'reopened';
    case 'edited':
      return 'edited';
    case 'created':
      return 'created';
    case 'deleted':
      return 'deleted';
    case 'published':
      return 'published';
    case 'submitted':
      return 'submitted';
    case 'dismissed':
      return 'dismissed';
    default:
      return action || 'updated';
  }
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function formatRelativeTime(dateString: string): string {
  const now = new Date();
  const date = new Date(dateString);
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 2592000) return `${Math.floor(diffInSeconds / 86400)}d ago`;

  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
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
  return parseInt(result.rows[0].count) < 15;
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
