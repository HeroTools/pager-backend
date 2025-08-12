export interface WebhookPayload {
  text?: string;
  channel?: string;
  username?: string;
  icon_url?: string;
  icon_emoji?: string;
  attachments?: Array<{
    color?: string;
    title?: string;
    text?: string;
    fields?: Array<{
      title: string;
      value: string;
      short?: boolean;
    }>;
  }>;
  blocks?: Array<any>; // Rich text blocks
}

export interface WebhookConfig {
  id: string;
  workspace_id: string;
  channel_id?: string;
  secret_token: string;
  signing_secret: string;
  settings: {
    rate_limit_per_minute: number;
    rate_limit_per_hour: number;
    max_message_length: number;
    allowed_message_types: string[];
    require_signature: boolean;
  };
}

export interface LinearWebhookPayload {
  action: string;
  type: string;
  data: {
    id: string;
    title?: string;
    description?: string;
    body?: string;
    url?: string;
    identifier?: string;
    number?: number;
    dueDate?: string;
    completedAt?: string;
    archivedAt?: string;
    priority?: number;
    priorityLabel?: string;
    estimate?: number;
    state?: {
      id: string;
      name: string;
      type: string;
      color: string;
    };
    assignee?: {
      id: string;
      name: string;
      email: string;
      url?: string;
    };
    creator?: {
      id: string;
      name: string;
      email: string;
      url?: string;
    };
    user?: {
      id: string;
      name: string;
      email: string;
      url?: string;
    };
    team?: {
      id: string;
      name: string;
      key: string;
    };
    project?: {
      id: string;
      name: string;
      url?: string;
      progress?: number;
      targetDate?: string;
      status?: string;
    };
    cycle?: {
      id: string;
      name: string;
      number: number;
      startsAt?: string;
      endsAt?: string;
      progress?: number;
    };
    milestone?: {
      id: string;
      name: string;
      targetDate?: string;
    };
    parent?: {
      id: string;
      title: string;
      identifier: string;
      url: string;
    };
    labels?: Array<{
      id: string;
      name: string;
      color: string;
    }>;
    subscribers?: Array<{
      id: string;
      name: string;
      email: string;
    }>;
    issue?: {
      id: string;
      title: string;
      identifier: string;
      url: string;
      team?: {
        id: string;
        name: string;
        key: string;
      };
    };
  };
  updatedFrom?: {
    description?: string;
    assigneeId?: string;
    stateId?: string;
    priority?: number;
    estimate?: number;
    dueDate?: string;
    projectId?: string;
    cycleId?: string;
    title?: string;
    updatedAt?: string;
  };
  createdAt: string;
  actor?: {
    id: string;
    name: string;
    email: string;
    url?: string;
    type?: string;
  };
}

export interface SlackAttachment {
  fallback?: string;
  color?: string;
  pretext?: string;
  author_name?: string;
  author_link?: string;
  author_icon?: string;
  title?: string;
  title_link?: string;
  text?: string;
  fields?: Array<{
    title: string;
    value: string;
    short?: boolean;
  }>;
  image_url?: string;
  thumb_url?: string;
  footer?: string;
  footer_icon?: string;
  ts?: number;
}

export interface SlackMessage {
  text?: string;
  username?: string;
  icon_url?: string;
  icon_emoji?: string;
  channel?: string;
  attachments?: SlackAttachment[];
  blocks?: any[];
  thread_ts?: string;
  mrkdwn?: boolean;
}

export interface QueuedMessage {
  webhookId: string;
  workspaceId: string;
  channelId: string;
  payload: SlackMessage;
  requestId: string;
  authenticatedUser: string;
}
