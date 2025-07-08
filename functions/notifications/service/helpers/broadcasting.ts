import { supabase } from '../../../common/utils/supabase-client';
import { CreatedNotification } from '../../types';

export const broadcastNotification = async (notification: CreatedNotification) => {
    try {
        const realtimeChannel = `workspace_member:${notification.workspace_member_id}`;

        await supabase.channel(realtimeChannel).send({
            type: 'broadcast',
            event: 'new_notification',
            payload: {
                notification: {
                    id: notification.id,
                    type: notification.type,
                    title: notification.title,
                    message: notification.message,
                    is_read: notification.is_read || false,
                    created_at: notification.created_at,
                    workspace_id: notification.workspace_id,
                    related_message_id: notification.related_message_id,
                    related_channel_id: notification.related_channel_id,
                    related_conversation_id: notification.related_conversation_id,
                },
                timestamp: new Date().toISOString(),
            },
        });

        console.log(`Notification broadcasted to ${realtimeChannel}`);
    } catch (error) {
        console.error('Failed to broadcast notification:', error);
    }
};
