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
  conversation_type: 'direct' | 'multi_user_agent' | 'group';
  is_public: boolean;
  description: string | null;
  creator_workspace_member_id: string | null;
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

export interface AgentMessageWithSender {
  id: string;
  body: string;
  workspace_member_id: string | null;
  ai_agent_id: string | null;
  workspace_id: string;
  channel_id: string | null;
  conversation_id: string;
  parent_message_id: string | null;
  thread_id: string | null;
  message_type: string;
  sender_type: 'user' | 'agent' | 'system';
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  blocks: any;
  metadata: any;
  reactions: Array<{
    id: string;
    value: string;
    count: number;
    users: Array<{ id: string; name: string }>;
  }>;
  attachments: Array<{
    id: string;
    original_filename: string;
    public_url: string;
    content_type: string;
    size_bytes: number;
    order_index: number;
  }>;
}

export interface AgentConversationData {
  conversation: {
    id: string;
    workspace_id: string;
    created_at: string;
    updated_at: string;
    title: string | null;
    conversation_type: 'direct' | 'multi_user_agent' | 'group';
    is_public: boolean;
    description: string | null;
    creator_workspace_member_id: string | null;
  };
  agent: {
    id: string;
    name: string;
    avatar_url: string | null;
    is_active: boolean;
  };
  messages: AgentMessageWithSender[];
  pagination: {
    hasMore: boolean;
    nextCursor: string | null;
    totalCount: number;
  };
  user_conversation_data: {
    member_id: string;
    last_read_message_id: string | null;
    workspace_member_id: string;
  };
  members?: Array<{
    id: string;
    role: string;
    joined_at: string;
    user?: {
      id: string;
      name: string;
      image: string | null;
    };
  }>;
}

export interface AgentConversationMessageFilters {
  limit?: number;
  cursor?: string;
  before?: string;
  include_reactions?: boolean;
  include_attachments?: boolean;
  include_count?: boolean;
}

export interface MultiUserAgentConversationCreateRequest {
  agentId: string;
  title: string;
  description?: string;
  isPublic?: boolean;
  initialUserIds?: string[]; // workspace_member_ids to invite initially
}

export interface MultiUserAgentConversationResponse {
  conversation: {
    id: string;
    workspace_id: string;
    title: string;
    description: string | null;
    conversation_type: 'multi_user_agent';
    is_public: boolean;
    creator_workspace_member_id: string;
    created_at: string;
    updated_at: string;
  };
  agent: {
    id: string;
    name: string;
    avatar_url: string | null;
    is_active: boolean;
  };
  members: Array<{
    id: string;
    role: string;
    joined_at: string;
    user: {
      id: string;
      name: string;
      image: string | null;
    };
  }>;
  invite_code?: string; // Only included if conversation is public
}

export interface ConversationInvite {
  id: string;
  conversation_id: string;
  invited_by_workspace_member_id: string;
  invited_workspace_member_id: string | null;
  invite_code: string | null;
  expires_at: string | null;
  used_at: string | null;
  created_at: string;
}

export interface JoinConversationRequest {
  inviteCode?: string;
  conversationId?: string; // For public conversations
}

export interface MessageWithResponseContext extends AgentMessageWithSender {
  response_context?: {
    grouped_with_message_ids?: string[];
    response_to_user_ids?: string[];
    is_grouped_response?: boolean;
  };
}
