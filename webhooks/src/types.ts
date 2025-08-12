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

export interface GitHubWebhookPayload {
  action?: string;
  number?: number;
  ref?: string;
  ref_type?: string;
  master_branch?: string;
  repository: {
    id: number;
    name: string;
    full_name: string;
    html_url: string;
    description?: string;
    private: boolean;
  };
  sender: {
    login: string;
    avatar_url: string;
    html_url: string;
  };
  organization?: {
    login: string;
    html_url: string;
  };
  pull_request?: {
    id: number;
    number: number;
    title: string;
    body?: string;
    html_url: string;
    state: string;
    merged: boolean;
    draft: boolean;
    user: {
      login: string;
      avatar_url: string;
    };
    head: {
      ref: string;
      sha: string;
    };
    base: {
      ref: string;
      sha: string;
    };
    assignees?: Array<{
      login: string;
      avatar_url: string;
    }>;
    requested_reviewers?: Array<{
      login: string;
      avatar_url: string;
    }>;
    labels?: Array<{
      name: string;
      color: string;
    }>;
  };
  issue?: {
    id: number;
    number: number;
    title: string;
    body?: string;
    html_url: string;
    state: string;
    user: {
      login: string;
      avatar_url: string;
    };
    assignees?: Array<{
      login: string;
      avatar_url: string;
    }>;
    labels?: Array<{
      name: string;
      color: string;
    }>;
  };
  comment?: {
    id: number;
    body: string;
    html_url: string;
    user: {
      login: string;
      avatar_url: string;
    };
  };
  commits?: Array<{
    id: string;
    message: string;
    timestamp: string;
    url: string;
    author: {
      name: string;
      email: string;
      username?: string;
    };
    committer: {
      name: string;
      email: string;
      username?: string;
    };
    added: string[];
    removed: string[];
    modified: string[];
  }>;
  compare?: string;
  head_commit?: {
    id: string;
    message: string;
    timestamp: string;
    url: string;
    author: {
      name: string;
      email: string;
      username?: string;
    };
    committer: {
      name: string;
      email: string;
      username?: string;
    };
  };
  release?: {
    id: number;
    tag_name: string;
    name?: string;
    body?: string;
    html_url: string;
    draft: boolean;
    prerelease: boolean;
    created_at: string;
    published_at: string;
    author: {
      login: string;
      avatar_url: string;
    };
  };
}

export interface JiraWebhookPayload {
  timestamp: number;
  webhookEvent: string;
  user?: {
    self: string;
    accountId: string;
    displayName: string;
    emailAddress?: string;
    avatarUrls?: {
      '48x48': string;
      '24x24': string;
      '16x16': string;
      '32x32': string;
    };
  };
  issue: {
    id: string;
    self: string;
    key: string;
    fields: {
      summary: string;
      description?: string;
      status: {
        self: string;
        description: string;
        iconUrl: string;
        name: string;
        id: string;
        statusCategory: {
          self: string;
          id: number;
          key: string;
          colorName: string;
          name: string;
        };
      };
      assignee?: {
        self: string;
        accountId: string;
        displayName: string;
        emailAddress?: string;
        avatarUrls?: {
          '48x48': string;
          '24x24': string;
          '16x16': string;
          '32x32': string;
        };
      };
      reporter?: {
        self: string;
        accountId: string;
        displayName: string;
        emailAddress?: string;
        avatarUrls?: {
          '48x48': string;
          '24x24': string;
          '16x16': string;
          '32x32': string;
        };
      };
      creator?: {
        self: string;
        accountId: string;
        displayName: string;
        emailAddress?: string;
        avatarUrls?: {
          '48x48': string;
          '24x24': string;
          '16x16': string;
          '32x32': string;
        };
      };
      priority?: {
        self: string;
        iconUrl: string;
        name: string;
        id: string;
      };
      issuetype: {
        self: string;
        id: string;
        description: string;
        iconUrl: string;
        name: string;
        subtask: boolean;
      };
      project: {
        self: string;
        id: string;
        key: string;
        name: string;
        projectTypeKey: string;
        simplified?: boolean;
        avatarUrls?: {
          '48x48': string;
          '24x24': string;
          '16x16': string;
          '32x32': string;
        };
      };
      labels?: string[];
      components?: Array<{
        self: string;
        id: string;
        name: string;
        description?: string;
      }>;
      fixVersions?: Array<{
        self: string;
        id: string;
        name: string;
        description?: string;
        archived: boolean;
        released: boolean;
      }>;
      duedate?: string;
      created: string;
      updated: string;
    };
  };
  changelog?: {
    id: string;
    items: Array<{
      field: string;
      fieldtype: string;
      fieldId?: string;
      from?: string;
      fromString?: string;
      to?: string;
      toString?: string;
    }>;
  };
  comment?: {
    self: string;
    id: string;
    author: {
      self: string;
      accountId: string;
      displayName: string;
      emailAddress?: string;
      avatarUrls?: {
        '48x48': string;
        '24x24': string;
        '16x16': string;
        '32x32': string;
      };
    };
    body: string;
    updateAuthor: {
      self: string;
      accountId: string;
      displayName: string;
      emailAddress?: string;
      avatarUrls?: {
        '48x48': string;
        '24x24': string;
        '16x16': string;
        '32x32': string;
      };
    };
    created: string;
    updated: string;
    visibility?: {
      type: string;
      value: string;
    };
  };
}

export interface QueuedMessage {
  webhookId: string;
  workspaceId: string;
  channelId: string;
  payload: SlackMessage;
  requestId: string;
  authenticatedUser: string;
}
