import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import dbPool from '../../common/utils/create-db-pool';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { errorResponse, successResponse } from '../../common/utils/response';
import { withCors } from '../../common/utils/cors';

const RegisterDeviceSchema = z.object({
  push_token: z.string().min(1),
  platform: z.enum(['ios', 'android']),
  device_name: z.string().optional(),
  device_model: z.string().optional(),
  os_version: z.string().optional(),
});

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client: PoolClient | null = null;

    try {
      // Parse and validate request body
      const bodyResult = RegisterDeviceSchema.safeParse(
        JSON.parse(event.body || '{}')
      );

      if (!bodyResult.success) {
        return errorResponse(
          `Invalid request: ${bodyResult.error.errors
            .map((e) => e.message)
            .join(', ')}`,
          400
        );
      }

      const { push_token, platform, device_name, device_model, os_version } = bodyResult.data;

      // Get user from token
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      client = await dbPool.connect();

      // Check if device already exists
      const existingDevice = await client.query(
        `SELECT id FROM push_devices 
         WHERE user_id = $1 AND push_token = $2`,
        [userId, push_token]
      );

      if (existingDevice.rows.length > 0) {
        // Update existing device
        await client.query(
          `UPDATE push_devices 
           SET 
             platform = $3,
             device_name = $4,
             device_model = $5,
             os_version = $6,
             last_seen_at = CURRENT_TIMESTAMP,
             is_active = true
           WHERE user_id = $1 AND push_token = $2`,
          [userId, push_token, platform, device_name, device_model, os_version]
        );

        return successResponse({
          message: 'Device updated successfully',
          device_id: existingDevice.rows[0].id,
        });
      } else {
        // Register new device
        const result = await client.query(
          `INSERT INTO push_devices (
             user_id,
             push_token,
             platform,
             device_name,
             device_model,
             os_version,
             is_active
           ) VALUES ($1, $2, $3, $4, $5, $6, true)
           RETURNING id`,
          [userId, push_token, platform, device_name, device_model, os_version]
        );

        return successResponse({
          message: 'Device registered successfully',
          device_id: result.rows[0].id,
        });
      }
    } catch (error) {
      console.error('Error registering device:', error);
      return errorResponse('Failed to register device', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  }
);