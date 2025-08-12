import { SQS } from '@aws-sdk/client-sqs';
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import crypto from 'crypto';
import dbPool from '../../../common/utils/create-db-pool';
import { LinearWebhookPayload, QueuedMessage, SlackMessage } from '../types';

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

    if (!isValidLinearEvent(linearPayload)) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Event ignored' }) };
    }

    const slackFormattedPayload = formatLinearEvent(linearPayload);
    if (!slackFormattedPayload) {
      return { statusCode: 200, body: JSON.stringify({ message: 'Event ignored' }) };
    }

    const queueMessage: QueuedMessage = {
      webhookId,
      workspaceId: webhook.workspace_id,
      channelId: webhook.channel_id,
      payload: slackFormattedPayload,
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

function isValidLinearEvent(payload: LinearWebhookPayload): boolean {
  if (!payload.action || !payload.type || !payload.data) {
    return false;
  }

  const supportedTypes = ['Issue', 'Comment', 'Project', 'Cycle'];
  const supportedActions = ['create', 'update', 'remove'];

  return supportedTypes.includes(payload.type) && supportedActions.includes(payload.action);
}

function formatLinearEvent(payload: LinearWebhookPayload): SlackMessage | null {
  const { action, type, data, updatedFrom, actor } = payload;

  switch (type) {
    case 'Issue':
      return formatIssueEvent(action, data, updatedFrom, actor);
    case 'Comment':
      return formatCommentEvent(action, data, actor);
    case 'Project':
      return formatProjectEvent(action, data, actor);
    case 'Cycle':
      return formatCycleEvent(action, data, actor);
    default:
      return null;
  }
}

function formatIssueEvent(
  action: string,
  data: LinearWebhookPayload['data'],
  updatedFrom?: LinearWebhookPayload['updatedFrom'],
  actor?: LinearWebhookPayload['actor'],
): SlackMessage {
  const color = getIssueColor(action, data.state?.name);

  if (action === 'update' && updatedFrom) {
    return formatIssueUpdateEvent(data, updatedFrom, color, actor);
  }

  const blocks = buildIssueBlocks(action, data, color, actor);

  return {
    username: 'Linear',
    icon_url: 'https://linear.app/favicon.ico',
    blocks,
  };
}

function formatIssueUpdateEvent(
  data: LinearWebhookPayload['data'],
  updatedFrom: LinearWebhookPayload['updatedFrom'],
  color: string,
  actor?: LinearWebhookPayload['actor'],
): SlackMessage {
  const changes = [];
  const significantChanges = [];

  if (updatedFrom) {
    if (updatedFrom.assigneeId !== undefined) {
      const oldAssignee = updatedFrom.assigneeId ? 'Previously assigned' : 'Unassigned';
      const newAssignee = data.assignee?.name || 'Unassigned';
      const change = `Assignee: ${oldAssignee} → ${newAssignee}`;
      changes.push(change);
      significantChanges.push('assignee');
    }

    if (updatedFrom.stateId !== undefined) {
      const change = `Status: ${data.state?.name || 'Unknown'}`;
      changes.push(change);
      significantChanges.push('status');
    }

    if (updatedFrom.priority !== undefined) {
      const oldPriority = getPriorityText(updatedFrom.priority);
      const newPriority = getPriorityText(data.priority || 0);
      const change = `Priority: ${oldPriority} → ${newPriority}`;
      changes.push(change);
      if (Math.abs((updatedFrom.priority || 0) - (data.priority || 0)) > 1) {
        significantChanges.push('priority');
      }
    }

    if (updatedFrom.estimate !== undefined) {
      const oldEstimate = updatedFrom.estimate ? `${updatedFrom.estimate}pt` : 'No estimate';
      const newEstimate = data.estimate ? `${data.estimate}pt` : 'No estimate';
      const change = `Estimate: ${oldEstimate} → ${newEstimate}`;
      changes.push(change);
    }

    if (updatedFrom.dueDate !== undefined) {
      const oldDue = updatedFrom.dueDate ? formatDate(updatedFrom.dueDate) : 'No due date';
      const newDue = data.dueDate ? formatDate(data.dueDate) : 'No due date';
      const change = `Due date: ${oldDue} → ${newDue}`;
      changes.push(change);
      significantChanges.push('due date');
    }

    if (updatedFrom.projectId !== undefined) {
      const projectName = data.project?.name || 'No project';
      const change = `Project: ${projectName}`;
      changes.push(change);
      significantChanges.push('project');
    }

    if (updatedFrom.cycleId !== undefined) {
      const cycleName = data.cycle?.name || 'No cycle';
      const change = `Cycle: ${cycleName}`;
      changes.push(change);
      significantChanges.push('cycle');
    }

    if (updatedFrom.description !== undefined) {
      changes.push('Description updated');
      significantChanges.push('description');
    }

    if (updatedFrom.title !== undefined) {
      const change = `Title: ${data.title}`;
      changes.push(change);
      significantChanges.push('title');
    }
  }

  if (changes.length === 0) {
    changes.push('Issue updated');
    significantChanges.push('other');
  }

  const updateSummary = getUpdateSummary(significantChanges);
  const headerText = updateSummary ? `Issue ${updateSummary}` : 'Issue Updated';

  // Clean and minimal: just what happened and to which issue
  const mainText = `*${headerText}*\n*<${data.url}|${data.identifier}>* ${data.title}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Show new description content cleanly
  if (updatedFrom?.description !== undefined && data.description) {
    const truncatedDescription = truncateText(data.description, 200);
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
        text: buildEnhancedContextLine(data, actor),
      },
    ],
  });

  return {
    username: 'Linear',
    icon_url: 'https://linear.app/favicon.ico',
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
      case 'project':
        return 'Moved to Project';
      case 'cycle':
        return 'Moved to Cycle';
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

function buildEnhancedContextLine(
  data: LinearWebhookPayload['data'],
  actor?: LinearWebhookPayload['actor'],
): string {
  const parts = [];

  if (actor) {
    parts.push(actor.name);
  }

  if (data.team) {
    parts.push(data.team.name);
  }

  const timeStr = formatRelativeTime(new Date().toISOString());
  parts.push(timeStr);

  return parts.join(' • ');
}

function buildDetailsSection(data: LinearWebhookPayload['data']): any | null {
  const primaryFields = [];
  const secondaryFields = [];

  // Primary info - most important details
  if (data.assignee) {
    primaryFields.push({
      type: 'mrkdwn',
      text: `*👤 Assignee*\n${data.assignee.name}`,
    });
  } else {
    primaryFields.push({
      type: 'mrkdwn',
      text: `*👤 Assignee*\nUnassigned`,
    });
  }

  if (data.state) {
    primaryFields.push({
      type: 'mrkdwn',
      text: `*📊 Status*\n${data.state.name}`,
    });
  }

  if (data.priority !== undefined && data.priority > 0) {
    const priorityText = data.priorityLabel || getPriorityText(data.priority);
    const priorityIndicator = getPriorityIndicator(data.priority);
    primaryFields.push({
      type: 'mrkdwn',
      text: `*⚡ Priority*\n${priorityIndicator} ${priorityText}`,
    });
  }

  // Secondary info - additional details
  if (data.estimate !== undefined && data.estimate > 0) {
    secondaryFields.push({
      type: 'mrkdwn',
      text: `*📏 Estimate*\n${data.estimate} point${data.estimate !== 1 ? 's' : ''}`,
    });
  }

  if (data.dueDate) {
    const dueDateFormatted = formatDate(data.dueDate);
    const isOverdue = new Date(data.dueDate) < new Date();
    const dueText = isOverdue ? `🔴 ${dueDateFormatted} (Overdue)` : dueDateFormatted;
    secondaryFields.push({
      type: 'mrkdwn',
      text: `*📅 Due Date*\n${dueText}`,
    });
  }

  if (data.cycle) {
    const cycleInfo = [];
    if (data.cycle.endsAt) {
      cycleInfo.push(formatDate(data.cycle.endsAt));
    }
    if (data.cycle.progress !== undefined) {
      cycleInfo.push(`${Math.round(data.cycle.progress * 100)}% complete`);
    }
    const cycleText =
      cycleInfo.length > 0 ? `${data.cycle.name} (${cycleInfo.join(', ')})` : data.cycle.name;

    secondaryFields.push({
      type: 'mrkdwn',
      text: `*🔄 Cycle*\n${cycleText}`,
    });
  }

  if (data.milestone) {
    const milestoneText = data.milestone.targetDate
      ? `${data.milestone.name} (${formatDate(data.milestone.targetDate)})`
      : data.milestone.name;
    secondaryFields.push({
      type: 'mrkdwn',
      text: `*🎯 Milestone*\n${milestoneText}`,
    });
  }

  if (data.parent) {
    secondaryFields.push({
      type: 'mrkdwn',
      text: `*🔗 Parent*\n<${data.parent.url}|${data.parent.identifier}> ${truncateText(data.parent.title, 30)}`,
    });
  }

  // Combine fields with primary ones first
  const allFields = [...primaryFields, ...secondaryFields];

  if (allFields.length === 0) return null;

  return {
    type: 'section',
    fields: allFields.slice(0, 10),
  };
}

function getPriorityIndicator(priority: number): string {
  switch (priority) {
    case 1:
      return '🔴';
    case 2:
      return '🟠';
    case 3:
      return '🟡';
    case 4:
      return '🔵';
    default:
      return '';
  }
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

function buildIssueBlocks(
  action: string,
  data: LinearWebhookPayload['data'],
  color: string,
  actor?: LinearWebhookPayload['actor'],
): any[] {
  const headerText = action === 'create' ? `New Issue Created` : `Issue ${getActionText(action)}`;

  // Clean and minimal: just what happened and to which issue
  const mainText = `*${headerText}*\n*<${data.url}|${data.identifier}>* ${data.title}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  // Show description for new issues
  if (data.description && action === 'create') {
    const truncatedDescription = truncateText(data.description, 200);
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
        text: buildEnhancedContextLine(data, actor),
      },
    ],
  });

  return blocks;
}

function formatCommentEvent(
  action: string,
  data: LinearWebhookPayload['data'],
  actor?: LinearWebhookPayload['actor'],
): SlackMessage {
  const commentAuthor = data.user || actor;
  const issue = data.issue;

  if (!issue) {
    return {
      username: 'Linear',
      icon_url: 'https://linear.app/favicon.ico',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Comment ${getActionText(action)}*\nNo issue information available`,
          },
        },
      ],
    };
  }

  const mainText = `*Comment ${getActionText(action)}*\n*<${issue.url}|${issue.identifier}>* ${issue.title}`;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: mainText,
      },
    },
  ];

  if (data.body) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: truncateText(data.body, 200),
      },
    });
  }

  const contextParts = [];
  if (commentAuthor) {
    contextParts.push(commentAuthor.name);
  }
  if (issue.team) {
    contextParts.push(issue.team.name);
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
    username: 'Linear',
    icon_url: 'https://linear.app/favicon.ico',
    blocks,
  };
}

function formatProjectEvent(
  action: string,
  data: LinearWebhookPayload['data'],
  actor?: LinearWebhookPayload['actor'],
): SlackMessage {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Project ${getActionText(action)}*\n*<${data.url}|${data.title || 'Project Update'}>*`,
      },
    },
  ];

  if (data.description) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `\`\`\`${truncateText(data.description, 200)}\`\`\``,
      },
    });
  }

  const projectFields = [];
  if (data.project?.progress !== undefined) {
    projectFields.push({
      type: 'mrkdwn',
      text: `*Progress*\n${Math.round(data.project.progress * 100)}%`,
    });
  }
  if (data.project?.targetDate) {
    projectFields.push({
      type: 'mrkdwn',
      text: `*Target Date*\n${formatDate(data.project.targetDate)}`,
    });
  }
  if (data.project?.status) {
    projectFields.push({
      type: 'mrkdwn',
      text: `*Status*\n${data.project.status}`,
    });
  }

  if (projectFields.length > 0) {
    blocks.push({
      type: 'section',
      fields: projectFields,
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: buildContextLine(data, actor),
      },
    ],
  });

  return {
    username: 'Linear',
    icon_url: 'https://linear.app/favicon.ico',
    blocks,
  };
}

function formatCycleEvent(
  action: string,
  data: LinearWebhookPayload['data'],
  actor?: LinearWebhookPayload['actor'],
): SlackMessage {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Cycle ${getActionText(action)}*\n*<${data.url}|${data.title || 'Cycle Update'}>*`,
      },
    },
  ];

  if (data.description) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `\`\`\`${truncateText(data.description, 200)}\`\`\``,
      },
    });
  }

  const cycleFields = [];
  if (data.cycle?.number) {
    cycleFields.push({
      type: 'mrkdwn',
      text: `*Cycle Number*\n#${data.cycle.number}`,
    });
  }
  if (data.cycle?.startsAt) {
    cycleFields.push({
      type: 'mrkdwn',
      text: `*Starts*\n${formatDate(data.cycle.startsAt)}`,
    });
  }
  if (data.cycle?.endsAt) {
    cycleFields.push({
      type: 'mrkdwn',
      text: `*Ends*\n${formatDate(data.cycle.endsAt)}`,
    });
  }
  if (data.cycle?.progress !== undefined) {
    cycleFields.push({
      type: 'mrkdwn',
      text: `*Progress*\n${Math.round(data.cycle.progress * 100)}%`,
    });
  }

  if (cycleFields.length > 0) {
    blocks.push({
      type: 'section',
      fields: cycleFields,
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: buildContextLine(data, actor),
      },
    ],
  });

  return {
    username: 'Linear',
    icon_url: 'https://linear.app/favicon.ico',
    blocks,
  };
}

function buildContextLine(
  data: LinearWebhookPayload['data'],
  actor?: LinearWebhookPayload['actor'],
): string {
  const parts = [];

  if (actor) {
    parts.push(`Updated by ${actor.name}`);
  }

  if (data.team) {
    parts.push(data.team.name);
  }

  if (data.project) {
    parts.push(data.project.name);
  }

  if (data.labels && data.labels.length > 0) {
    const labelNames = data.labels.map((label) => label.name).join(', ');
    parts.push(`Labels: ${labelNames}`);
  }

  if (data.subscribers && data.subscribers.length > 0) {
    const subscriberCount = data.subscribers.length;
    parts.push(`${subscriberCount} subscriber${subscriberCount !== 1 ? 's' : ''}`);
  }

  parts.push(`Linear • ${new Date().toLocaleString()}`);

  return parts.join(' • ');
}

function getIssueColor(action: string, state?: string): string {
  if (action === 'create') return 'good';
  if (action === 'remove') return 'danger';

  if (state) {
    switch (state.toLowerCase()) {
      case 'done':
      case 'completed':
        return 'good';
      case 'in progress':
      case 'started':
        return 'warning';
      case 'todo':
      case 'backlog':
        return '#6c757d';
      default:
        return '#5E6AD2';
    }
  }

  return '#5E6AD2';
}

function getActionText(action: string): string {
  switch (action) {
    case 'create':
      return 'created';
    case 'update':
      return 'updated';
    case 'remove':
      return 'removed';
    default:
      return action;
  }
}

function getPriorityText(priority: number): string {
  switch (priority) {
    case 0:
      return 'No Priority';
    case 1:
      return 'Urgent';
    case 2:
      return 'High';
    case 3:
      return 'Normal';
    case 4:
      return 'Low';
    default:
      return `Priority ${priority}`;
  }
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
