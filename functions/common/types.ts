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
