// types/webhook.ts
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
