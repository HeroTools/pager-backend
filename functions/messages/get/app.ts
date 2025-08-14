import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { withCors } from '../../../common/utils/cors';
import { errorResponse, successResponse } from '../../../common/utils/response';
import { supabase } from '../../../common/utils/supabase-client';
import { populateReactions } from '../helpers/populate-reactions';
import { populateThread } from './helpers/populate-thread';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);

      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const {
        channelId,
        conversationId,
        parentMessageId,
        limit = '20',
        offset = '0',
      } = event.queryStringParameters || {};

      let _conversationId = conversationId;

      // Handle thread context
      if (!conversationId && !channelId && parentMessageId) {
        const { data: parentMessage } = await supabase
          .from('messages')
          .select('conversation_id')
          .eq('id', parentMessageId)
          .single();

        if (!parentMessage) {
          return errorResponse('Parent message not found', 404);
        }

        _conversationId = parentMessage.conversation_id;
      }

      // Build query
      let query = supabase
        .from('messages')
        .select(
          `
          *,
          members!inner(
            id,
            role,
            users!inner(
              id,
              name,
              image
            )
          )
        `,
        )
        .order('created_at', { ascending: false })
        .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

      // Apply filters
      if (channelId) {
        query = query.eq('channel_id', channelId);
      }
      if (_conversationId) {
        query = query.eq('conversation_id', _conversationId);
      }
      if (parentMessageId) {
        query = query.eq('parent_message_id', parentMessageId);
      }

      const { data: messages, error } = await query;

      if (error) {
        return errorResponse('Internal server error', 500);
      }

      // Populate additional data for each message
      const populatedMessages = await Promise.all(
        (messages || []).map(async (message) => {
          const reactions = await populateReactions(message.id);
          const thread = await populateThread(message.id);

          return {
            ...message,
            member: message.members,
            user: message.members?.users,
            reactions,
            threadCount: thread.count,
            threadImage: thread.image,
            threadTimestamp: thread.timestamp,
            threadName: thread.name,
          };
        }),
      );

      return successResponse({
        page: populatedMessages,
        isDone: populatedMessages.length < parseInt(limit),
      });
    } catch (error) {
      console.error('Error getting messages:', error);
      return errorResponse('Internal server error', 500);
    }
  },
);
