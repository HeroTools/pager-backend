import { SQS } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import crypto from 'crypto';
import dbPool from '../../../common/utils/create-db-pool';
import { JiraWebhookPayload, QueuedMessage, SlackMessage } from '../types';

const sqs = new SQS({ region: process.env.AWS_REGION || 'us-east-2' });

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  console.log('=== JIRA WEBHOOK HANDLER STARTED ===');
  console.log('Event:', JSON.stringify(event, null, 2));
  
  const requestId = crypto.randomUUID();
  console.log('Request ID:', requestId);

  try {
    const webhookId = event.pathParameters?.webhookId;
    console.log('Webhook ID:', webhookId);
    
    if (!webhookId) {
      console.log('No webhook ID - returning 400');
      return errorResponse(400, 'Webhook ID required', requestId);
    }

    const webhook = await getWebhook(webhookId);
    console.log('Webhook lookup result:', webhook);
    
    if (!webhook) {
      console.log('Webhook not found - returning 404');
      return errorResponse(404, 'Webhook not found', requestId);
    }

    console.log('Headers:', JSON.stringify(event.headers, null, 2));
    console.log('Body length:', event.body?.length || 0);

    // Jira uses x-hub-signature header with SHA256 HMAC (same as GitHub)
    if (!verifyJiraSignature(
      event.body || '',
      event.headers['x-hub-signature'],
      webhook.signing_secret,
    )) {
      console.log('Jira signature verification failed - returning 401');
      return errorResponse(401, 'Invalid signature', requestId);
    }

    console.log('Signature verification passed');

    const canProceed = await checkRateLimit(webhookId);
    if (!canProceed) {
      return errorResponse(429, 'Rate limit exceeded', requestId);
    }

    const jiraPayload: JiraWebhookPayload = JSON.parse(event.body || '{}');
    console.log('Parsed Jira payload:', JSON.stringify(jiraPayload, null, 2));

    if (!isValidJiraEvent(jiraPayload)) {
      console.log('Invalid Jira event - event ignored:', jiraPayload.webhookEvent);
      return { statusCode: 200, body: JSON.stringify({ message: 'Event ignored' }) };
    }

    const slackFormattedPayload = formatJiraEvent(jiraPayload);
    console.log('Formatted Slack payload:', JSON.stringify(slackFormattedPayload, null, 2));
    
    if (!slackFormattedPayload) {
      console.log('No formatted payload - event ignored');
      return { statusCode: 200, body: JSON.stringify({ message: 'Event ignored' }) };
    }

    const queueMessage: QueuedMessage = {
      webhookId,
      workspaceId: webhook.workspace_id,
      channelId: webhook.channel_id,
      payload: slackFormattedPayload,
      requestId,
      authenticatedUser: 'jira-webhook',
    };

    console.log('Sending SQS message:', JSON.stringify(queueMessage, null, 2));
    console.log('Queue URL:', process.env.WEBHOOK_QUEUE_URL);

    const sqsResult = await sqs.sendMessage({
      QueueUrl: process.env.WEBHOOK_QUEUE_URL!,
      MessageBody: JSON.stringify(queueMessage),
      MessageGroupId: webhookId,
    });

    console.log('SQS send result:', JSON.stringify(sqsResult, null, 2));

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
    console.error('=== JIRA WEBHOOK HANDLER ERROR ===');
    console.error('Error details:', error);
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    console.error('Request ID:', requestId);
    return errorResponse(500, 'Internal server error', requestId);
  }
};

function isValidJiraEvent(payload: JiraWebhookPayload): boolean {
  if (!payload.webhookEvent) {
    console.log('No webhookEvent found in payload');
    return false;
  }

  const supportedEvents = [
    'jira:issue_created',
    'jira:issue_updated',
    'jira:issue_deleted',
    'comment_created',
    'comment_updated',
  ];

  if (!supportedEvents.includes(payload.webhookEvent)) {
    console.log('Unsupported webhook event:', payload.webhookEvent);
    return false;
  }

  // For comment events, we might not have an issue field at the top level
  if (payload.webhookEvent.includes('comment')) {
    return true;
  }

  // For issue events, we need an issue field
  if (!payload.issue) {
    console.log('No issue found in payload for issue event');
    return false;
  }

  return true;
}

function formatJiraEvent(payload: JiraWebhookPayload): SlackMessage | null {
  const { webhookEvent } = payload;

  switch (webhookEvent) {
    case 'jira:issue_created':
      return formatIssueCreatedEvent(payload);
    case 'jira:issue_updated':
      return formatIssueUpdatedEvent(payload);
    case 'jira:issue_deleted':
      return formatIssueDeletedEvent(payload);
    case 'comment_created':
    case 'comment_updated':
      return formatCommentEvent(payload);
    default:
      return null;
  }
}

function formatIssueCreatedEvent(payload: JiraWebhookPayload): SlackMessage {
  const { issue, user } = payload;
  const color = getIssueColor('created', issue.fields.status.statusCategory.colorName);

  const mainText = `*New Issue Created*\n*<${getJiraUrl(issue)}|${issue.key}>* ${issue.fields.summary}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  if (issue.fields.description) {
    const truncatedDescription = truncateText(issue.fields.description, 200);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncatedDescription,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: buildContextLine(issue, user),
      },
    ],
  });

  return {
    username: 'Jira',
    icon_url: 'https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon.png',
    blocks,
  };
}

function formatIssueUpdatedEvent(payload: JiraWebhookPayload): SlackMessage {
  const { issue, user, changelog } = payload;
  const color = getIssueColor('updated', issue.fields.status.statusCategory.colorName);

  const changes = [];
  const significantChanges = [];

  if (changelog?.items) {
    for (const item of changelog.items) {
      switch (item.field) {
        case 'assignee':
          const oldAssignee = item.fromString || 'Unassigned';
          const newAssignee = item.toString || 'Unassigned';
          changes.push(`Assignee: ${oldAssignee} → ${newAssignee}`);
          significantChanges.push('assignee');
          break;
        case 'status':
          changes.push(`Status: ${item.toString || 'Unknown'}`);
          significantChanges.push('status');
          break;
        case 'priority':
          const oldPriority = item.fromString || 'None';
          const newPriority = item.toString || 'None';
          changes.push(`Priority: ${oldPriority} → ${newPriority}`);
          significantChanges.push('priority');
          break;
        case 'summary':
          changes.push(`Title: ${item.toString}`);
          significantChanges.push('title');
          break;
        case 'description':
          changes.push('Description updated');
          significantChanges.push('description');
          break;
        case 'duedate':
          const oldDue = item.fromString ? formatDate(item.fromString) : 'No due date';
          const newDue = item.toString ? formatDate(item.toString) : 'No due date';
          changes.push(`Due date: ${oldDue} → ${newDue}`);
          significantChanges.push('due date');
          break;
        case 'Component':
        case 'components':
          changes.push(`Components: ${item.toString || 'None'}`);
          significantChanges.push('components');
          break;
        case 'Fix Version':
        case 'fixVersions':
          changes.push(`Fix Version: ${item.toString || 'None'}`);
          significantChanges.push('fix version');
          break;
      }
    }
  }

  if (changes.length === 0) {
    changes.push('Issue updated');
    significantChanges.push('other');
  }

  const updateSummary = getUpdateSummary(significantChanges);
  const headerText = updateSummary ? `Issue ${updateSummary}` : 'Issue Updated';

  const mainText = `*${headerText}*\n*<${getJiraUrl(issue)}|${issue.key}>* ${issue.fields.summary}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  if (significantChanges.includes('description') && issue.fields.description) {
    const truncatedDescription = truncateText(issue.fields.description, 200);
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncatedDescription,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: buildContextLine(issue, user),
      },
    ],
  });

  return {
    username: 'Jira',
    icon_url: 'https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon.png',
    blocks,
  };
}

function formatIssueDeletedEvent(payload: JiraWebhookPayload): SlackMessage {
  const { issue, user } = payload;

  const mainText = `*Issue Deleted*\n*${issue.key}* ${issue.fields.summary}`;

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
          text: buildContextLine(issue, user),
        },
      ],
    },
  ];

  return {
    username: 'Jira',
    icon_url: 'https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon.png',
    blocks,
  };
}

function formatCommentEvent(payload: JiraWebhookPayload): SlackMessage {
  const { issue, comment, webhookEvent } = payload;
  const action = webhookEvent === 'comment_created' ? 'added' : 'updated';

  const mainText = `*Comment ${action}*\n*<${getJiraUrl(issue)}|${issue.key}>* ${issue.fields.summary}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  if (comment?.body) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateText(comment.body, 200),
      },
    });
  }

  const contextParts = [];
  if (comment?.author) {
    contextParts.push(comment.author.displayName);
  }
  if (issue.fields.project) {
    contextParts.push(issue.fields.project.name);
  }
  contextParts.push(formatRelativeTime(new Date().toISOString()));

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: contextParts.join(' • '),
      },
    ],
  });

  return {
    username: 'Jira',
    icon_url: 'https://wac-cdn.atlassian.com/assets/img/favicons/atlassian/favicon.png',
    blocks,
  };
}

function getUpdateSummary(significantChanges: string[]): string {
  if (significantChanges.length === 0) return 'Updated';
  if (significantChanges.length === 1) {
    const change = significantChanges[0];
    switch (change) {
      case 'assignee':
        return 'Reassigned';
      case 'status':
        return 'Status Changed';
      case 'priority':
        return 'Priority Updated';
      case 'due date':
        return 'Due Date Changed';
      case 'components':
        return 'Components Updated';
      case 'fix version':
        return 'Fix Version Updated';
      case 'description':
        return 'Description Updated';
      case 'title':
        return 'Title Updated';
      default:
        return 'Updated';
    }
  }
  if (significantChanges.length === 2) {
    return `${significantChanges[0]} and ${significantChanges[1]} updated`;
  }
  return `${significantChanges.length} fields updated`;
}

function buildContextLine(
  issue: JiraWebhookPayload['issue'],
  user?: JiraWebhookPayload['user'],
): string {
  const parts = [];

  if (user) {
    parts.push(user.displayName);
  }

  if (issue.fields.project) {
    parts.push(issue.fields.project.name);
  }

  const timeStr = formatRelativeTime(new Date().toISOString());
  parts.push(timeStr);

  return parts.join(' • ');
}

function getIssueColor(action: string, statusColor?: string): string {
  if (action === 'created') return 'good';
  if (action === 'deleted') return 'danger';

  if (statusColor) {
    switch (statusColor.toLowerCase()) {
      case 'green':
        return 'good';
      case 'yellow':
        return 'warning';
      case 'blue-gray':
      case 'medium-gray':
        return '#6c757d';
      default:
        return '#0052CC';
    }
  }

  return '#0052CC';
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

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffInDays = Math.floor((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffInDays === 0) {
      return 'Today';
    } else if (diffInDays === 1) {
      return 'Tomorrow';
    } else if (diffInDays === -1) {
      return 'Yesterday';
    } else if (diffInDays > 0 && diffInDays <= 7) {
      return `In ${diffInDays} days`;
    } else if (diffInDays < 0 && diffInDays >= -7) {
      return `${Math.abs(diffInDays)} days ago`;
    } else {
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
      });
    }
  } catch {
    return dateString;
  }
}

function getJiraUrl(issue: JiraWebhookPayload['issue']): string {
  try {
    // Extract base URL from the self URL
    // Example: https://askbexai.atlassian.net/rest/api/2/issue/10041
    // Should become: https://askbexai.atlassian.net/browse/KEY-123
    
    const selfUrl = issue.self;
    console.log('Original self URL:', selfUrl);
    
    // Find the base URL (everything before /rest/api/2/issue/)
    const baseUrlMatch = selfUrl.match(/^(https?:\/\/[^\/]+)/);
    if (!baseUrlMatch) {
      console.error('Could not extract base URL from:', selfUrl);
      return selfUrl; // Fallback to original URL
    }
    
    const baseUrl = baseUrlMatch[1];
    const browseUrl = `${baseUrl}/browse/${issue.key}`;
    
    console.log('Constructed browse URL:', browseUrl);
    return browseUrl;
  } catch (error) {
    console.error('Error constructing Jira URL:', error);
    return issue.self; // Fallback to original URL
  }
}

function verifyJiraSignature(
  body: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) {
    console.log('No signature header found');
    return false;
  }

  try {
    // Jira uses x-hub-signature format: "sha256=<hex_digest>"
    if (!signature.startsWith('sha256=')) {
      console.log('Invalid signature format - expected sha256=');
      return false;
    }

    const receivedSignature = signature.substring(7); // Remove "sha256=" prefix
    
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(body);
    const expectedSignature = hmac.digest('hex');

    console.log('Received signature:', receivedSignature);
    console.log('Expected signature:', expectedSignature);

    // Ensure both strings are the same length for timingSafeEqual
    if (receivedSignature.length !== expectedSignature.length) {
      console.log('Signature length mismatch');
      return false;
    }

    const isValid = crypto.timingSafeEqual(Buffer.from(receivedSignature), Buffer.from(expectedSignature));
    console.log('Signature verification result:', isValid);
    
    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
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
  return parseInt(result.rows[0].count) < 15;
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
