import { MessageWithUser } from '../../common/types';

export interface ChannelMemberWithUser {
  id: string;
  channel_id: string;
  workspace_member_id: string;
  joined_at: string;
  role: string | null;
  notifications_enabled: boolean;
  last_read_message_id: string | null;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
  status?: {
    status: string;
    custom_status: string | null;
    status_emoji: string | null;
    last_seen_at: string | null;
  };
}

export interface ChannelData {
  messages: MessageWithUser[];
  members: ChannelMemberWithUser[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    totalCount: number;
  };
}

export interface Message {
  id: string;
  body: string;
  workspace_member_id: string;
  workspace_id: string;
  channel_id: string | null;
  conversation_id: string | null;
  parent_message_id: string | null;
  thread_id: string | null;
  message_type: string;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  blocks?: any;
  metadata?: any;
}

export interface EnrichedMessage extends Message {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
  attachments?: Array<{
    id: string;
    url: string;
    content_type: string;
    size_bytes: number;
  }>;
  reactions?: Array<{
    id: string;
    value: string;
    count: number;
    users: Array<{ id: string; name: string }>;
  }>;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface UserStatus {
  user_id: string;
  status: string;
  custom_status: string | null;
  status_emoji: string | null;
  last_seen_at: string | null;
}
