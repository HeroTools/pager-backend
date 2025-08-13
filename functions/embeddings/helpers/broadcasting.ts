import { supabase } from '../../../common/utils/supabase-client';

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
