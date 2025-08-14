export interface NotificationEvent {
  messageId: string;
  senderWorkspaceMemberId: string;
  workspaceId: string;
  channelId?: string;
  conversationId?: string;
  messageText: string;
  parentMessageId?: string;
  threadId?: string;
  senderName: string;
  mentionedWorkspaceMemberIds: string[];
}

export interface Notification {
  workspace_member_id: string;
  sender_workspace_member_id: string | null;
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
