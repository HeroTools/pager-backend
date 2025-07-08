export interface User {
    id: string;
    name: string;
    image: string | null;
}

export interface WorkspaceMember {
    id: string;
    role: string;
    user_id: string;
}

export interface ConversationMember {
    id: string;
    conversation_id: string;
    workspace_member_id: string;
    joined_at: string;
    left_at: string | null;
    is_hidden: boolean;
}

export interface ConversationMemberWithDetails {
    id: string;
    joined_at: string;
    left_at: string | null;
    is_hidden: boolean;
    workspace_member: {
        id: string;
        role: string;
        user: User;
    };
}

export interface Conversation {
    id: string;
    workspace_id: string;
    created_at: string;
    updated_at: string;
    members: ConversationMemberWithDetails[];
    member_count: number;
    other_members: ConversationMemberWithDetails[];
    is_group_conversation: boolean;
}

export interface MessageWithUser {
    id: string;
    body: string;
    attachment_id: string | null;
    workspace_member_id: string;
    workspace_id: string;
    channel_id: string | null;
    conversation_id: string;
    parent_message_id: string | null;
    thread_id: string | null;
    message_type: string;
    created_at: string;
    updated_at: string | null;
    edited_at: string | null;
    deleted_at: string | null;
    user: {
        id: string;
        name: string;
        email: string;
        image: string | null;
    };
    attachment?: {
        id: string;
        url: string;
        content_type: string | null;
        size_bytes: number | null;
    };
    reactions?: Array<{
        id: string;
        value: string;
        count: number;
        users: Array<{
            id: string;
            name: string;
        }>;
    }>;
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

export interface ConversationData {
    conversation: {
        id: string;
        workspace_id: string;
        created_at: string;
        updated_at: string;
    };
    messages: MessageWithUser[];
    members: ConversationMemberWithUser[];
    pagination: {
        hasMore: boolean;
        nextCursor: string | null;
        totalCount: number;
    };
}
