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

export interface StripeWebhookPayload {
  id: string;
  object: 'event';
  api_version: string;
  created: number;
  data: {
    object: any;
    previous_attributes?: any;
  };
  livemode: boolean;
  pending_webhooks: number;
  request: {
    id: string | null;
    idempotency_key: string | null;
  };
  type: string;
}

export interface StripeCustomer {
  id: string;
  object: 'customer';
  balance: number;
  created: number;
  currency: string | null;
  default_source: string | null;
  delinquent: boolean;
  description: string | null;
  discount: any;
  email: string | null;
  invoice_prefix: string;
  livemode: boolean;
  metadata: Record<string, string>;
  name: string | null;
  phone: string | null;
  preferred_locales: string[];
  shipping: any;
  tax_exempt: string;
  test_clock: string | null;
}

export interface StripeSubscription {
  id: string;
  object: 'subscription';
  application: string | null;
  application_fee_percent: number | null;
  automatic_tax: {
    enabled: boolean;
  };
  billing_cycle_anchor: number;
  billing_thresholds: any;
  cancel_at: number | null;
  cancel_at_period_end: boolean;
  canceled_at: number | null;
  collection_method: string;
  created: number;
  currency: string;
  current_period_end: number;
  current_period_start: number;
  customer: string;
  default_payment_method: string | null;
  description: string | null;
  discount: any;
  ended_at: number | null;
  items: {
    object: 'list';
    data: Array<{
      id: string;
      object: 'subscription_item';
      created: number;
      metadata: Record<string, string>;
      price: {
        id: string;
        object: 'price';
        active: boolean;
        billing_scheme: string;
        created: number;
        currency: string;
        livemode: boolean;
        lookup_key: string | null;
        metadata: Record<string, string>;
        nickname: string | null;
        product: string;
        recurring: {
          aggregate_usage: string | null;
          interval: string;
          interval_count: number;
          usage_type: string;
        };
        tax_behavior: string;
        tiers_mode: string | null;
        transform_quantity: any;
        type: string;
        unit_amount: number;
        unit_amount_decimal: string;
      };
      quantity: number;
      subscription: string;
      tax_rates: any[];
    }>;
    has_more: boolean;
    total_count: number;
    url: string;
  };
  latest_invoice: string;
  livemode: boolean;
  metadata: Record<string, string>;
  next_pending_invoice_item_invoice: number | null;
  on_behalf_of: string | null;
  pause_collection: any;
  payment_settings: {
    payment_method_options: any;
    payment_method_types: any;
    save_default_payment_method: string;
  };
  pending_invoice_item_interval: any;
  pending_setup_intent: string | null;
  pending_update: any;
  schedule: string | null;
  start_date: number;
  status: string;
  test_clock: string | null;
  transfer_data: any;
  trial_end: number | null;
  trial_settings: {
    end_behavior: {
      missing_payment_method: string;
    };
  };
  trial_start: number | null;
}

export interface StripeInvoice {
  id: string;
  object: 'invoice';
  account_country: string;
  account_name: string;
  account_tax_ids: any[];
  amount_due: number;
  amount_paid: number;
  amount_remaining: number;
  application: string | null;
  application_fee_amount: number | null;
  attempt_count: number;
  attempted: boolean;
  auto_advance: boolean;
  billing_reason: string;
  charge: string | null;
  collection_method: string;
  created: number;
  currency: string;
  customer: string;
  customer_address: any;
  customer_email: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_shipping: any;
  customer_tax_exempt: string;
  customer_tax_ids: any[];
  default_payment_method: string | null;
  default_source: string | null;
  description: string | null;
  discount: any;
  discounts: any[];
  due_date: number | null;
  ending_balance: number | null;
  footer: string | null;
  from_invoice: any;
  hosted_invoice_url: string;
  invoice_pdf: string;
  last_finalization_error: any;
  latest_revision: string | null;
  lines: {
    object: 'list';
    data: Array<{
      id: string;
      object: 'line_item';
      amount: number;
      amount_excluding_tax: number;
      currency: string;
      description: string;
      discount_amounts: any[];
      discountable: boolean;
      discounts: any[];
      invoice_item: string;
      livemode: boolean;
      metadata: Record<string, string>;
      period: {
        end: number;
        start: number;
      };
      price: {
        id: string;
        object: 'price';
        active: boolean;
        billing_scheme: string;
        created: number;
        currency: string;
        livemode: boolean;
        lookup_key: string | null;
        metadata: Record<string, string>;
        nickname: string | null;
        product: string;
        recurring: {
          aggregate_usage: string | null;
          interval: string;
          interval_count: number;
          usage_type: string;
        } | null;
        tax_behavior: string;
        tiers_mode: string | null;
        transform_quantity: any;
        type: string;
        unit_amount: number;
        unit_amount_decimal: string;
      };
      proration: boolean;
      proration_details: {
        credited_items: any;
      };
      quantity: number;
      subscription: string | null;
      subscription_item: string | null;
      tax_amounts: any[];
      tax_rates: any[];
      type: string;
      unit_amount_excluding_tax: string;
    }>;
    has_more: boolean;
    total_count: number;
    url: string;
  };
  livemode: boolean;
  metadata: Record<string, string>;
  next_payment_attempt: number | null;
  number: string;
  on_behalf_of: string | null;
  paid: boolean;
  paid_out_of_band: boolean;
  payment_intent: string | null;
  payment_settings: {
    default_mandate: string | null;
    payment_method_options: any;
    payment_method_types: any;
  };
  period_end: number;
  period_start: number;
  post_payment_credit_notes_amount: number;
  pre_payment_credit_notes_amount: number;
  quote: string | null;
  receipt_number: string | null;
  rendering_options: any;
  shipping_cost: any;
  shipping_details: any;
  starting_balance: number;
  statement_descriptor: string | null;
  status: string;
  status_transitions: {
    finalized_at: number | null;
    marked_uncollectible_at: number | null;
    paid_at: number | null;
    voided_at: number | null;
  };
  subscription: string | null;
  subscription_details: {
    metadata: Record<string, string>;
  };
  subtotal: number;
  subtotal_excluding_tax: number;
  tax: number | null;
  test_clock: string | null;
  total: number;
  total_discount_amounts: any[];
  total_excluding_tax: number;
  total_tax_amounts: any[];
  transfer_data: any;
  webhooks_delivered_at: number | null;
}

export interface StripePaymentIntent {
  id: string;
  object: 'payment_intent';
  amount: number;
  amount_capturable: number;
  amount_details: {
    tip: Record<string, any>;
  };
  amount_received: number;
  application: string | null;
  application_fee_amount: number | null;
  automatic_payment_methods: any;
  canceled_at: number | null;
  cancellation_reason: string | null;
  capture_method: string;
  client_secret: string;
  confirmation_method: string;
  created: number;
  currency: string;
  customer: string | null;
  description: string | null;
  invoice: string | null;
  last_payment_error: any;
  latest_charge: string | null;
  livemode: boolean;
  metadata: Record<string, string>;
  next_action: any;
  on_behalf_of: string | null;
  payment_method: string | null;
  payment_method_options: Record<string, any>;
  payment_method_types: string[];
  processing: any;
  receipt_email: string | null;
  review: string | null;
  setup_future_usage: string | null;
  shipping: any;
  source: string | null;
  statement_descriptor: string | null;
  statement_descriptor_suffix: string | null;
  status: string;
  transfer_data: any;
  transfer_group: string | null;
}

export interface StripeCheckoutSession {
  id: string;
  object: 'checkout.session';
  after_expiration: any;
  allow_promotion_codes: boolean | null;
  amount_subtotal: number | null;
  amount_total: number | null;
  automatic_tax: {
    enabled: boolean;
    status: string | null;
  };
  billing_address_collection: string | null;
  cancel_url: string;
  client_reference_id: string | null;
  consent: any;
  consent_collection: any;
  created: number;
  currency: string | null;
  customer: string | null;
  customer_creation: string | null;
  customer_details: {
    address: any;
    email: string | null;
    name: string | null;
    phone: string | null;
    tax_exempt: string | null;
    tax_ids: any[];
  } | null;
  customer_email: string | null;
  expires_at: number;
  invoice: string | null;
  invoice_creation: any;
  livemode: boolean;
  locale: string | null;
  metadata: Record<string, string>;
  mode: string;
  payment_intent: string | null;
  payment_link: string | null;
  payment_method_collection: string;
  payment_method_options: Record<string, any>;
  payment_method_types: string[];
  payment_status: string;
  phone_number_collection: {
    enabled: boolean;
  };
  recovered_from: string | null;
  setup_intent: string | null;
  shipping_address_collection: any;
  shipping_cost: any;
  shipping_details: any;
  shipping_options: any[];
  status: string;
  submit_type: string | null;
  subscription: string | null;
  success_url: string;
  total_details: {
    amount_discount: number;
    amount_shipping: number;
    amount_tax: number;
  } | null;
  url: string | null;
}

export interface StripeRefund {
  id: string;
  object: 'refund';
  amount: number;
  charge: string;
  created: number;
  currency: string;
  metadata: Record<string, string>;
  payment_intent: string | null;
  reason: string | null;
  receipt_number: string | null;
  source_transfer_reversal: string | null;
  status: string;
  transfer_reversal: string | null;
}

export interface StripeSetupIntent {
  id: string;
  object: 'setup_intent';
  application: string | null;
  attach_to_self: boolean;
  automatic_payment_methods: any;
  cancellation_reason: string | null;
  client_secret: string;
  created: number;
  customer: string | null;
  description: string | null;
  flow_directions: string[] | null;
  last_setup_error: any;
  latest_attempt: string | null;
  livemode: boolean;
  mandate: string | null;
  metadata: Record<string, string>;
  next_action: any;
  on_behalf_of: string | null;
  payment_method: string | null;
  payment_method_options: Record<string, any>;
  payment_method_types: string[];
  single_use_mandate: string | null;
  status: string;
  usage: string;
}

export interface StripePaymentMethod {
  id: string;
  object: 'payment_method';
  billing_details: {
    address: any;
    email: string | null;
    name: string | null;
    phone: string | null;
  };
  card: {
    brand: string;
    checks: {
      address_line1_check: string | null;
      address_postal_code_check: string | null;
      cvc_check: string | null;
    };
    country: string;
    exp_month: number;
    exp_year: number;
    fingerprint: string;
    funding: string;
    generated_from: any;
    last4: string;
    networks: {
      available: string[];
      preferred: string | null;
    };
    three_d_secure_usage: {
      supported: boolean;
    };
    wallet: any;
  } | null;
  created: number;
  customer: string | null;
  livemode: boolean;
  metadata: Record<string, string>;
  type: string;
}

export interface QueuedMessage {
  webhookId: string;
  workspaceId: string;
  channelId: string;
  payload: SlackMessage;
  requestId: string;
  authenticatedUser: string;
}
