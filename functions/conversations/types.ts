import { MessageWithUser } from '../../common/types';

export interface User {
  id: string;
  name: string;
  image: string | null;
}

export interface WorkspaceMember {
  id: string;
  role: string;
  user_id: string;
  is_deactivated: boolean;
}

export interface Agent {
  id: string;
  name: string;
  description?: string;
  avatar_url?: string;
  model: string;
  is_active: boolean;
}

export interface ConversationMember {
  id: string;
  conversation_id: string;
  workspace_member_id: string | null;
  ai_agent_id: string | null;
  joined_at: string;
  left_at: string | null;
  is_hidden: boolean;
  last_read_message_id: string | null;
}

export interface ConversationMemberWithDetails {
  id: string;
  joined_at: string;
  left_at: string | null;
  is_hidden: boolean;
  last_read_message_id: string | null;
  workspace_member: {
    id: string;
    role: string;
    is_deactivated: boolean;
    user: User;
  };
}

export interface Conversation {
  id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
  title?: string;
  members: ConversationMemberWithDetails[];
  member_count: number;
  other_members: ConversationMemberWithDetails[];
  is_group_conversation: boolean;
}

export interface ConversationMemberWithUser {
  id: string;
  conversation_id: string;
  workspace_member_id: string;
  joined_at: string;
  left_at: string | null;
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

export interface ConversationMemberWithAgent {
  id: string;
  conversation_id: string;
  ai_agent_id: string;
  joined_at: string;
  left_at: string | null;
  last_read_message_id: string | null;
  agent: Agent;
}

export interface ConversationData {
  conversation: {
    id: string;
    workspace_id: string;
    created_at: string;
    updated_at: string;
    title?: string;
  };
  messages: MessageWithUser[];
  members: (ConversationMemberWithUser | ConversationMemberWithAgent)[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    totalCount: number;
  };
}
