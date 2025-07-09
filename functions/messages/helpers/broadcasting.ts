import { supabase } from '../../common/utils/supabase-client';

// Real-time broadcast helper
export const broadcastMessage = async (
  message: any,
  channelId?: string,
  conversationId?: string,
) => {
  try {
    // Determine the real-time channel to broadcast to
    const realtimeChannel = channelId ? `channel:${channelId}` : `conversation:${conversationId}`;

    // Broadcast using Supabase real-time
    await supabase.channel(realtimeChannel).send({
      type: 'broadcast',
      event: 'new_message',
      payload: {
        message,
        channel_id: channelId,
        conversation_id: conversationId,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`Message broadcasted to ${realtimeChannel}`);
  } catch (error) {
    console.error('Failed to broadcast message:', error);
    // Don't fail the whole request if broadcast fails
  }
};

// Send typing notifications
export const broadcastTypingStatus = async (
  userId: string,
  channelId?: string,
  conversationId?: string,
  isTyping = false,
) => {
  const realtimeChannel = channelId ? `channel:${channelId}` : `conversation:${conversationId}`;

  await supabase.channel(realtimeChannel).send({
    type: 'broadcast',
    event: 'typing_status',
    payload: {
      user_id: userId,
      is_typing: isTyping,
      channel_id: channelId,
      conversation_id: conversationId,
      timestamp: new Date().toISOString(),
    },
  });
};

export const broadcastMessageUpdate = async (
  message: any,
  workspaceId: string,
  channelId?: string,
  conversationId?: string,
) => {
  try {
    const realtimeChannel = channelId ? `channel:${channelId}` : `conversation:${conversationId}`;

    await supabase.channel(realtimeChannel).send({
      type: 'broadcast',
      event: 'message_updated',
      payload: {
        message,
        workspace_id: workspaceId,
        channel_id: channelId,
        conversation_id: conversationId,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`Message broadcasted to ${realtimeChannel}`);
  } catch (error) {
    console.error('Failed to broadcast message:', error);
  }
};
