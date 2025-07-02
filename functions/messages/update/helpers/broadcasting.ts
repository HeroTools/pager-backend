import { supabase } from '../utils/supabase-client';

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
