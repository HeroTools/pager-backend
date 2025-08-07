import apn from '@parse/node-apn';
import { Expo, ExpoPushMessage } from 'expo-server-sdk';
import { PoolClient } from 'pg';

interface PushNotificationConfig {
  apns: {
    key: string;
    keyId: string;
    teamId: string;
    production: boolean;
  };
}

interface NotificationPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
  badge?: number;
  sound?: string;
}

class PushNotificationService {
  private apnProvider: apn.Provider | null = null;
  private expo: Expo;

  constructor() {
    this.expo = new Expo();
    this.initializeAPNS();
  }

  /**
   * Initialize Apple Push Notification Service
   */
  private initializeAPNS() {
    try {
      // Only initialize if we have the required environment variables
      if (
        process.env.APNS_KEY_PATH &&
        process.env.APNS_KEY_ID &&
        process.env.APNS_TEAM_ID
      ) {
        const options: apn.ProviderOptions = {
          token: {
            key: process.env.APNS_KEY_PATH,
            keyId: process.env.APNS_KEY_ID,
            teamId: process.env.APNS_TEAM_ID,
          },
          production: process.env.APNS_PRODUCTION === 'true',
        };

        this.apnProvider = new apn.Provider(options);
        console.log('APNS Provider initialized successfully');
      } else {
        console.log('APNS credentials not configured, using Expo push service only');
      }
    } catch (error) {
      console.error('Failed to initialize APNS:', error);
    }
  }

  /**
   * Send push notification to a user
   */
  async sendToUser(
    client: PoolClient,
    payload: NotificationPayload
  ): Promise<void> {
    try {
      // Get all active devices for the user
      const devices = await client.query(
        `SELECT push_token, platform 
         FROM push_devices 
         WHERE user_id = $1 AND is_active = true`,
        [payload.userId]
      );

      if (devices.rows.length === 0) {
        console.log(`No active devices found for user ${payload.userId}`);
        return;
      }

      // Send to all user's devices
      const promises = devices.rows.map((device) =>
        this.sendToDevice(device.push_token, device.platform, payload)
      );

      await Promise.allSettled(promises);
    } catch (error) {
      console.error('Error sending push notification to user:', error);
    }
  }

  /**
   * Send push notification to specific device
   */
  private async sendToDevice(
    token: string,
    platform: 'ios' | 'android',
    payload: NotificationPayload
  ): Promise<void> {
    try {
      // Check if it's an Expo push token
      if (Expo.isExpoPushToken(token)) {
        await this.sendExpoNotification(token, payload);
      } else if (platform === 'ios' && this.apnProvider) {
        await this.sendAPNSNotification(token, payload);
      } else {
        console.log(`Unsupported token type or platform: ${platform}`);
      }
    } catch (error) {
      console.error(`Error sending to device ${token}:`, error);
      // Consider marking device as inactive after multiple failures
    }
  }

  /**
   * Send notification using Expo push service
   */
  private async sendExpoNotification(
    token: string,
    payload: NotificationPayload
  ): Promise<void> {
    const message: ExpoPushMessage = {
      to: token,
      sound: 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data,
      badge: payload.badge,
    };

    const chunks = this.expo.chunkPushNotifications([message]);
    
    for (const chunk of chunks) {
      try {
        const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
        console.log('Expo notification sent:', ticketChunk);
      } catch (error) {
        console.error('Error sending Expo notification:', error);
      }
    }
  }

  /**
   * Send notification using Apple Push Notification Service
   */
  private async sendAPNSNotification(
    token: string,
    payload: NotificationPayload
  ): Promise<void> {
    if (!this.apnProvider) {
      throw new Error('APNS provider not initialized');
    }

    const notification = new apn.Notification();
    
    notification.expiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour
    notification.badge = payload.badge;
    notification.sound = payload.sound || 'default';
    notification.alert = {
      title: payload.title,
      body: payload.body,
    };
    notification.payload = payload.data || {};
    notification.topic = 'team.pager.app'; // Your bundle ID
    
    try {
      const result = await this.apnProvider.send(notification, token);
      
      if (result.failed.length > 0) {
        console.error('APNS failures:', result.failed);
      }
      
      if (result.sent.length > 0) {
        console.log('APNS notification sent successfully');
      }
    } catch (error) {
      console.error('Error sending APNS notification:', error);
    }
  }

  /**
   * Send notification to multiple users
   */
  async sendToUsers(
    client: PoolClient,
    userIds: string[],
    payload: Omit<NotificationPayload, 'userId'>
  ): Promise<void> {
    const promises = userIds.map((userId) =>
      this.sendToUser(client, { ...payload, userId })
    );
    
    await Promise.allSettled(promises);
  }

  /**
   * Update badge count for a user
   */
  async updateBadgeCount(
    client: PoolClient,
    userId: string,
    count: number
  ): Promise<void> {
    await this.sendToUser(client, {
      userId,
      title: '',
      body: '',
      badge: count,
    });
  }

  /**
   * Clean up resources
   */
  shutdown() {
    if (this.apnProvider) {
      this.apnProvider.shutdown();
    }
  }
}

// Export singleton instance
export const pushNotificationService = new PushNotificationService();