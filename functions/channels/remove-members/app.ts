import { APIGatewayProxyHandler } from 'aws-lambda';
import { z, ZodError } from 'zod';
import { PoolClient } from 'pg';
import { getUserIdFromToken } from './helpers/auth';
import { getWorkspaceMember } from './helpers/get-member';
import { successResponse, errorResponse } from './utils/response';
import dbPool from './utils/create-db-pool';

const removeMembersRequestSchema = z.object({
    memberIds: z.string().array().min(1, 'memberIds array cannot be empty'),
});

const pathParamsSchema = z.object({
    workspaceId: z.string().uuid(),
    channelId: z.string().uuid(),
});

export const handler: APIGatewayProxyHandler = async (event, context) => {
    context.callbackWaitsForEmptyEventLoop = false;
    let client: PoolClient | undefined;

    try {
        const userId = await getUserIdFromToken(event.headers.Authorization);
        if (!userId) {
            return errorResponse('Unauthorized', 401);
        }

        const { workspaceId, channelId } = pathParamsSchema.parse(event.pathParameters);
        const { memberIds } = removeMembersRequestSchema.parse(JSON.parse(event.body || '{}'));

        client = await dbPool.connect();

        const requestingMember = await getWorkspaceMember(client, workspaceId, userId);
        if (!requestingMember) {
            return errorResponse('User is not a member of this workspace', 403);
        }

        // Check if requesting user is a member of the channel and get their role
        const channelMemberResult = await client.query(
            `SELECT cm.role, c.channel_type 
             FROM channel_members cm
             JOIN channels c ON cm.channel_id = c.id
             WHERE cm.channel_id = $1 AND cm.workspace_member_id = $2`,
            [channelId, requestingMember.id],
        );

        if (channelMemberResult.rows.length === 0) {
            return errorResponse('User is not a member of this channel', 403);
        }

        const { role: requestingUserChannelRole } = channelMemberResult.rows[0];

        // Get channel members to remove and their roles
        const channelMembersResult = await client.query(
            `SELECT cm.workspace_member_id, cm.role, wm.user_id, u.name, u.email
             FROM channel_members cm
             JOIN workspace_members wm ON cm.workspace_member_id = wm.id
             JOIN users u ON wm.user_id = u.id
             WHERE cm.channel_id = $1 AND cm.workspace_member_id = ANY($2::uuid[])`,
            [channelId, memberIds],
        );

        if (channelMembersResult.rows.length === 0) {
            return errorResponse('No valid channel members found to remove', 404);
        }

        const foundMemberIds = new Set(channelMembersResult.rows.map((row: any) => row.workspace_member_id));
        const notFoundMemberIds = memberIds.filter((id) => !foundMemberIds.has(id));

        // Check permissions for each member to be removed
        const membersToRemove = channelMembersResult.rows;
        const unauthorizedRemovals: any[] = [];

        for (const member of membersToRemove) {
            const isRemovingSelf = member.workspace_member_id === requestingMember.id;
            const isTargetAdmin = member.role === 'admin';
            const isRequesterAdmin = requestingUserChannelRole === 'admin';

            // Business rules:
            // 1. Channel admins cannot be removed by non-admins
            // 2. Only channel admins can remove other members (except self-removal)
            // 3. Members can always remove themselves
            if (!isRemovingSelf && !isRequesterAdmin) {
                unauthorizedRemovals.push({
                    memberId: member.workspace_member_id,
                    reason: 'Only channel admins can remove other members',
                });
            } else if (isTargetAdmin && !isRemovingSelf) {
                unauthorizedRemovals.push({
                    memberId: member.workspace_member_id,
                    reason: 'Channel admins cannot be removed by other users',
                });
            }
        }

        if (unauthorizedRemovals.length > 0) {
            return errorResponse('Insufficient permissions to remove some members', 403, {
                unauthorized: unauthorizedRemovals,
            });
        }

        // Remove the members from the channel
        const removeMembersResult = await client.query(
            `DELETE FROM channel_members 
             WHERE channel_id = $1 AND workspace_member_id = ANY($2::uuid[])
             RETURNING workspace_member_id`,
            [channelId, Array.from(foundMemberIds)],
        );

        const removedMemberIds = removeMembersResult.rows.map((row: any) => row.workspace_member_id);

        // Prepare response data
        const removedMembersDetails = membersToRemove
            .filter((member: any) => removedMemberIds.includes(member.workspace_member_id))
            .map((member: any) => ({
                workspaceMemberId: member.workspace_member_id,
                userId: member.user_id,
                name: member.name,
                email: member.email,
                role: member.role,
            }));

        return successResponse({
            channel_id: channelId,
            removed_members: removedMembersDetails,
            not_found_members: notFoundMemberIds,
            summary: {
                total_requested: memberIds.length,
                successfully_removed: removedMemberIds.length,
                not_found: notFoundMemberIds.length,
            },
        });
    } catch (error) {
        console.error('Error removing members from channel:', error);

        if (error instanceof ZodError) {
            return errorResponse('Invalid request data', 400, error.errors);
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
};
