import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { z, ZodError } from 'zod';
import { PoolClient } from 'pg';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getWorkspaceMember } from '../../common/helpers/get-member';
import { successResponse, errorResponse } from '../../common/utils/response';
import dbPool from '../../common/utils/create-db-pool';
import { withCors } from '../../common/utils/cors';

const removeMembersRequestSchema = z.object({
  channelMemberIds: z.string().array().min(1, 'channelMemberIds array cannot be empty'),
});

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('workspaceId is required'),
  channelId: z.string().uuid('channelId is required'),
});

export const handler = withCors(
  async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
    context.callbackWaitsForEmptyEventLoop = false;
    let client: PoolClient | undefined;

    try {
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      const { workspaceId, channelId } = pathParamsSchema.parse(event.pathParameters);
      const { channelMemberIds } = removeMembersRequestSchema.parse(JSON.parse(event.body || '{}'));

      client = await dbPool.connect();

      const requestingMember = await getWorkspaceMember(client, workspaceId, userId);
      if (!requestingMember) {
        return errorResponse('User is not a member of this workspace', 403);
      }

      // Check if requesting user is a member of the channel and get their role
      const channelMemberResult = await client.query(
        `SELECT cm.role 
             FROM channel_members cm
             WHERE cm.channel_id = $1 AND cm.workspace_member_id = $2`,
        [channelId, requestingMember.id],
      );

      if (channelMemberResult.rows.length === 0) {
        return errorResponse('User is not a member of this channel', 403);
      }

      const { role: requestingUserChannelRole } = channelMemberResult.rows[0];

      // Get channel members to remove and their roles
      const channelMembersResult = await client.query(
        `SELECT cm.id as channel_member_id, cm.workspace_member_id, cm.role
             FROM channel_members cm
             WHERE cm.channel_id = $1 AND cm.id = ANY($2::uuid[])`,
        [channelId, channelMemberIds],
      );

      if (channelMembersResult.rows.length === 0) {
        return errorResponse('No valid channel members found to remove', 404);
      }

      const foundChannelMemberIds = new Set(
        channelMembersResult.rows.map((row: any) => row.channel_member_id),
      );

      // Check permissions for each member to be removed
      const membersToRemove = channelMembersResult.rows;
      const unauthorizedRemovals: any[] = [];

      for (const member of membersToRemove) {
        const isRemovingSelf = member.workspace_member_id === requestingMember.id;
        // const isTargetAdmin = member.role === 'admin';
        const isRequesterAdmin = requestingUserChannelRole === 'admin';

        // Business rules:
        // 1. Non-admins cannot remove any members (except themselves)
        // 2. Admins can remove any member (including other admins)
        // 3. Members can always remove themselves
        if (!isRemovingSelf && !isRequesterAdmin) {
          unauthorizedRemovals.push({
            channelMemberId: member.channel_member_id,
            reason: 'Only channel admins can remove other members',
          });
        }
      }

      if (unauthorizedRemovals.length > 0) {
        return errorResponse(
          'Insufficient permissions to remove some members',
          403,
          {},
          {
            unauthorized: unauthorizedRemovals,
          },
        );
      }

      // Remove the members from the channel
      await client.query(
        `DELETE FROM channel_members 
             WHERE id = ANY($1::uuid[])`,
        [Array.from(foundChannelMemberIds)],
      );

      return successResponse(
        {
          success: true,
        },
        200,
      );
    } catch (error) {
      console.error('Error removing members from channel:', error);

      if (error instanceof ZodError) {
        return errorResponse('Invalid request data', 400, {}, { details: error.errors });
      }

      if (error instanceof Error && 'code' in error) {
        switch ((error as any).code) {
          case '23503':
            return errorResponse('Invalid channel or member reference', 400);
        }
      }

      return errorResponse('Internal server error', 500);
    } finally {
      client?.release();
    }
  },
);
