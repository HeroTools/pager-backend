import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import { supabase } from '../../common/utils/supabase-client';
import { errorResponse, successResponse } from '../../common/utils/response';

interface TypingRequest {
  is_typing: boolean;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const userId = await getUserIdFromToken(event.headers.Authorization);

    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const workspaceId = event.pathParameters?.workspaceId;
    const channelId = event.pathParameters?.channelId;
    const conversationId = event.pathParameters?.conversationId;

    if (!workspaceId) {
      return errorResponse('Workspace ID is required', 400);
    }

    if (!channelId && !conversationId) {
      return errorResponse('Either channel ID or conversation ID is required', 400);
    }

    const requestBody: TypingRequest = JSON.parse(event.body || '{}');
    const { is_typing } = requestBody;

    const workspaceMember = await getMember(workspaceId, userId);

    if (!workspaceMember) {
      return errorResponse('Not a member of this workspace', 403);
    }

    // Validate access to channel/conversation (same logic as send message)
    if (channelId) {
      const { data: channelMember, error: channelMemberError } = await supabase
        .from('channel_members')
        .select('id')
        .eq('channel_id', channelId)
        .eq('workspace_member_id', workspaceMember.id)
        .single();

      if (channelMemberError || !channelMember) {
        const { data: channel, error: channelError } = await supabase
          .from('channels')
          .select('id, channel_type')
          .eq('id', channelId)
          .single();

        if (channelError || !channel || channel.channel_type !== 'public') {
          return errorResponse('Not a member of this channel', 403);
        }
      }
    }

    if (conversationId) {
      const { data: conversationMember, error: conversationMemberError } = await supabase
        .from('conversation_members')
        .select('id')
        .eq('conversation_id', conversationId)
        .eq('workspace_member_id', workspaceMember.id)
        .is('left_at', null)
        .single();

      if (conversationMemberError || !conversationMember) {
        return errorResponse('Not a member of this conversation', 403);
      }
    }

    // Get user info for the typing indicator
    const { data: user, error: userError } = await supabase
      .from('workspace_members')
      .select(
        `
                id,
                users!workspace_members_user_id_fkey1 (
                    id,
                    name,
                    image
                )
            `,
      )
      .eq('id', workspaceMember.id)
      .maybeSingle();

    console.log(user);

    if (userError || !user) {
      return errorResponse('User not found', 404);
    }

    // Broadcast typing status
    const realtimeChannel = channelId ? `channel:${channelId}` : `conversation:${conversationId}`;

    await supabase.channel(realtimeChannel).send({
      type: 'broadcast',
      event: 'typing_status',
      payload: {
        user: {
          id: user.users.id,
          name: user.users.name,
          image: user.users.image,
        },
        workspace_member_id: workspaceMember.id,
        is_typing,
        channel_id: channelId,
        conversation_id: conversationId,
        timestamp: new Date().toISOString(),
      },
    });

    return successResponse({
      message: `Typing status ${is_typing ? 'started' : 'stopped'}`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error handling typing indicator:', error);
    return errorResponse('Internal server error', 500);
  }
};
