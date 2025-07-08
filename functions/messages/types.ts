export interface CompleteMessage {
    id: string;
    body: string;
    text: string;
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
    user_id: string;
    user_name: string;
    user_email: string;
    user_image: string | null;
    attachments: any[];
}
