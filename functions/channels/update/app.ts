import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getChannelMember } from '../../common/helpers/get-member';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse, errorResponse } from '../../common/utils/response';
import { parseChannelName } from '../helpers/parse-channel-name';
import { withCors } from '../../common/utils/cors';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);

      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const channelId = event.pathParameters?.channelId;
      const workspaceId = event.pathParameters?.workspaceId;
      const { name, channel_type, description } = JSON.parse(event.body || '{}');

      if (!channelId || !workspaceId) {
        return errorResponse('Channel ID and workspace ID are required', 400);
      }

      if (!name && !channel_type && description === undefined) {
        return errorResponse(
          'At least one field (name, channel_type, or description) is required',
          400,
        );
      }

      // Validate channel_type if provided
      if (channel_type && !['public', 'private'].includes(channel_type)) {
        return errorResponse('Channel type must be either "public" or "private"', 400);
      }

      const channelMember = await getChannelMember(channelId, userId, workspaceId);

      if (!channelMember || channelMember.role !== 'admin') {
        return errorResponse('Admin access required', 403);
      }

      // Prepare update object with only provided fields
      const updateData: any = {
        updated_at: new Date().toISOString(),
      };

      if (name) {
        const parsedName = parseChannelName(name);
        updateData.name = parsedName;
      }

      if (channel_type) {
        updateData.channel_type = channel_type;
      }

      if (description !== undefined) {
        updateData.description = description;
      }

      // Update channel
      const { error } = await supabase.from('channels').update(updateData).eq('id', channelId);

      if (error) {
        throw error;
      }

      return successResponse({ channelId }, 200);
    } catch (error) {
      console.error('Error updating channel:', error);
      return errorResponse(
        'Internal server error',
        500,
        {},
        {
          details: (error as Error).message,
        },
      );
    }
  },
);
