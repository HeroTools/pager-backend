import { APIGatewayProxyHandler } from 'aws-lambda';
import { z, ZodError } from 'zod';
import { PoolClient } from 'pg';
import { getUserIdFromToken } from './helpers/auth';
import { getWorkspaceMember } from './helpers/get-member';
import { successResponse, errorResponse } from './utils/response';
import dbPool from './utils/create-db-pool';

const inviteMembersRequestSchema = z.object({
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
        const { memberIds } = inviteMembersRequestSchema.parse(JSON.parse(event.body || '{}'));

        client = await dbPool.connect();

        const requestingMember = await getWorkspaceMember(client, workspaceId, userId);
        if (!requestingMember) {
            return errorResponse('User is not a member of this workspace', 403);
        }

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

        const { role: requestingUserChannelRole, channel_type: channelType } = channelMemberResult.rows[0];

        if (channelType === 'private' && requestingUserChannelRole !== 'admin') {
            return errorResponse('Only channel admins can invite members to private channels', 403);
        }

        const validMembersResult = await client.query(
            `SELECT id FROM workspace_members 
             WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND is_deactivated = false`,
            [memberIds, workspaceId],
        );

        if (validMembersResult.rows.length !== memberIds.length) {
            const validIds = new Set(validMembersResult.rows.map((row) => row.id));
            const invalidIds = memberIds.filter((id) => !validIds.has(id));
            return errorResponse(`Invalid or deactivated member IDs: ${invalidIds.join(', ')}`, 400);
        }

        const existingMembersResult = await client.query(
            `SELECT workspace_member_id FROM channel_members 
             WHERE channel_id = $1 AND workspace_member_id = ANY($2::uuid[])`,
            [channelId, memberIds],
        );

        const existingMemberIds = new Set(existingMembersResult.rows.map((row) => row.workspace_member_id));
        const newMemberIds = memberIds.filter((id) => !existingMemberIds.has(id));

        if (newMemberIds.length === 0) {
            return errorResponse('All specified members are already in the channel', 409);
        }

        const valuesPlaceholder = newMemberIds
            .map((_, index) => `($1, $${index + 2}, $${newMemberIds.length + 2})`)
            .join(', ');
        const inviteQuery = `
            INSERT INTO channel_members (channel_id, workspace_member_id, role)
            VALUES ${valuesPlaceholder}
            RETURNING workspace_member_id, joined_at
        `;

        const inviteParams = [channelId, ...newMemberIds];
        const newChannelMembers = await client.query(inviteQuery, inviteParams);

        const invitedMembersResult = await client.query(
            `SELECT wm.id as "workspaceMemberId", u.id as "userId", u.name, u.email
             FROM workspace_members wm
             JOIN users u ON wm.user_id = u.id
             WHERE wm.id = ANY($1::uuid[])`,
            [newMemberIds],
        );

        const invitedMembersMap = new Map(newChannelMembers.rows.map((m) => [m.workspace_member_id, m.joined_at]));

        const invitedMembersDetails = invitedMembersResult.rows.map((member) => ({
            ...member,
            role: 'member',
            joinedAt: invitedMembersMap.get(member.workspaceMemberId),
        }));

        return successResponse({
            channel_id: channelId,
            invited_members: invitedMembersDetails,
            already_members: Array.from(existingMemberIds),
            summary: {
                total_requested: memberIds.length,
                newly_invited: newMemberIds.length,
                already_in_channel: existingMemberIds.size,
            },
        });
    } catch (error) {
        console.error('Error inviting members to channel:', error);

        if (error instanceof ZodError) {
            return errorResponse('Invalid request data', 400, error.errors);
        }

        if (error instanceof Error && 'code' in error) {
            switch ((error as any).code) {
                case '23503':
                    return errorResponse('Invalid channel or member reference', 400);
                case '23505':
                    return errorResponse('One or more members are already in the channel', 409);
            }
        }

        return errorResponse('Internal server error', 500);
    } finally {
        client?.release();
    }
};
