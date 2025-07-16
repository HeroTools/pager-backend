export interface AgentCreatedBy {
  name: string;
  image: string | null;
}

export interface AgentEntity {
  id: string;
  name: string;
  description: string | null;
  model: string;
  avatar_url: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: AgentCreatedBy | null;
}

export interface AgentFilters {
  include_inactive?: boolean;
}

export interface AgentConversationLastMessage {
  body: string;
  created_at: string;
  sender_type: 'user' | 'agent' | 'system';
  sender_name: string;
}

export interface AgentConversation {
  id: string;
  workspace_id: string;
  created_at: string;
  updated_at: string;
  title: string | null;
  last_read_message_id: string | null;
  is_hidden: boolean;
  last_message: AgentConversationLastMessage | null;
}

export interface AgentConversationsResponse {
  agent: {
    id: string;
    name: string;
    avatar_url: string | null;
    is_active: boolean;
  };
  conversations: AgentConversation[];
  pagination: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export interface AgentConversationFilters {
  include_hidden?: boolean;
  limit?: number;
  cursor?: string; // timestamp cursor for pagination
}
