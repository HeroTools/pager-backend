export interface MessageWithUser {
    id: string;
    body: string;
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
    blocks: string[];
    metadata: Record<string, unknown>;
    user: {
        id: string;
        name: string;
        email: string;
        image: string | null;
    };
    attachments?: Array<{
        id: string;
        url: string;
        content_type: string | null;
        size_bytes: number | null;
    }>;
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
