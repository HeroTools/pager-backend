export interface CompleteMessage {
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
    user_id: string;
    user_name: string;
    user_email: string;
    user_image: string | null;
    attachments: any[];
}

export interface NotificationEvent {
    messageId: string;
    senderWorkspaceMemberId: string;
    workspaceId: string;
    channelId?: string;
    conversationId?: string;
    messageBody: string;
    parentMessageId?: string;
    threadId?: string;
    senderName: string;
}

export interface Notification {
    workspace_member_id: string;
    sender_workspace_member_id: string;
    workspace_id: string;
    type: 'mention' | 'direct_message' | 'channel_message' | 'thread_reply';
    title: string;
    message: string;
    related_message_id: string;
    related_channel_id?: string;
    related_conversation_id?: string;
}

export interface CreatedNotification extends Notification {
    id: string;
    created_at: string;
    is_read: boolean;
}
