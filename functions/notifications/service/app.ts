import { Handler } from 'aws-lambda';
import { PoolClient } from 'pg';

import dbPool from './utils/create-db-pool';
import { broadcastNotification } from './helpers/broadcasting';
import { extractAndResolveMentions } from './helpers/mentions';
import {
    createMentionNotifications,
    createDirectMessageNotifications,
    createThreadReplyNotifications,
    createChannelMessageNotifications,
} from './helpers/notification-builders';
import { insertNotifications } from './helpers/notification-database';
import { NotificationEvent, Notification } from './types';

async function processMessageNotifications(event: NotificationEvent): Promise<void> {
    let client: PoolClient | null = null;

    try {
        client = await dbPool.connect();

        const notifications: Notification[] = [];
        const {
            messageId,
            senderWorkspaceMemberId,
            workspaceId,
            channelId,
            conversationId,
            messageBody,
            parentMessageId,
            threadId,
            senderName,
        } = event;

        console.log('event:', event);

        // 1. Handle channel messages (notify all members for now)
        if (channelId) {
            const channelNotifications = await createChannelMessageNotifications(
                client,
                channelId,
                senderWorkspaceMemberId,
                workspaceId,
                messageId,
                messageBody,
                senderName,
            );
            notifications.push(...channelNotifications);
        }

        // 2. Handle mentions (for additional context in notifications)
        const mentionedUserIds = await extractAndResolveMentions(client, messageBody, workspaceId);
        if (mentionedUserIds.length > 0) {
            const mentionNotifications = await createMentionNotifications(
                client,
                mentionedUserIds,
                senderWorkspaceMemberId,
                workspaceId,
                messageId,
                messageBody,
                senderName,
                channelId,
                conversationId,
                notifications,
            );
            notifications.push(...mentionNotifications);
        }

        // 3. Handle direct messages
        if (conversationId) {
            const dmNotifications = await createDirectMessageNotifications(
                client,
                conversationId,
                senderWorkspaceMemberId,
                workspaceId,
                messageId,
                messageBody,
                senderName,
                notifications,
            );
            notifications.push(...dmNotifications);
        }

        // 4. Handle thread replies
        if (parentMessageId) {
            const threadNotifications = await createThreadReplyNotifications(
                client,
                parentMessageId,
                threadId,
                senderWorkspaceMemberId,
                workspaceId,
                messageId,
                messageBody,
                senderName,
                channelId,
                conversationId,
                notifications,
            );
            notifications.push(...threadNotifications);
        }

        // 5. Insert and broadcast notifications
        if (notifications.length > 0) {
            const createdNotifications = await insertNotifications(client, notifications);
            console.log(`Created ${notifications.length} notifications for message ${messageId}`);

            // 6. Broadcast notifications in real-time
            await Promise.allSettled(createdNotifications.map((notification) => broadcastNotification(notification)));
        }
    } catch (error) {
        console.error('Error processing notifications:', error);
        throw error;
    } finally {
        if (client) {
            client.release();
        }
    }
}

export const handler: Handler = async (event: NotificationEvent) => {
    try {
        console.log('Processing notifications for message:', event.messageId);
        await processMessageNotifications(event);
        console.log('Notifications processed successfully');

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true }),
        };
    } catch (error) {
        console.error('Notification processing failed:', error);

        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to process notifications' }),
        };
    }
};
