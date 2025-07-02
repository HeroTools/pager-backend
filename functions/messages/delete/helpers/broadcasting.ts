import { supabase } from '../utils/supabase-client';

export const broadcastMessageDelete = async (
    workspaceId: string,
    messageId: string,
    parentMessageId: string | null,
    channelId: string | null,
    conversationId: string | null,
) => {
    try {
        const realtimeChannel = channelId ? `channel:${channelId}` : `conversation:${conversationId}`;

        await supabase.channel(realtimeChannel).send({
            type: 'broadcast',
            event: 'message_deleted',
            payload: {
                message_id: messageId,
                parent_message_id: parentMessageId,
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
