import { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { z, ZodError } from 'zod';
import { PoolClient, DatabaseError } from 'pg';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getWorkspaceMember } from '../../common/helpers/get-member';
import { successResponse, errorResponse } from '../../common/utils/response';
import dbPool from '../../common/utils/create-db-pool';
import { ApplicationError, AuthError, ChannelError } from '../../common/utils/errors';
import { withCors } from '../../common/utils/cors';

const CHANNEL_MEMBER_ROLE = 'member';
const PRIVATE_CHANNEL_TYPE = 'private';
const ADMIN_ROLE = 'admin';
const MAX_INVITE_BATCH_SIZE = 50;

const inviteMembersRequestSchema = z.object({
  memberIds: z
    .string()
    .uuid('Invalid member ID format')
    .array()
    .min(1, 'At least one member ID required')
    .max(MAX_INVITE_BATCH_SIZE, `Cannot invite more than ${MAX_INVITE_BATCH_SIZE} members at once`),
});

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
  channelId: z.string().uuid('Invalid channel ID format'),
});

interface ChannelInfo {
  channelType: string;
  requestingUserRole: string | null;
  existingMemberIds: string[];
}

const getChannelInfoAndValidateAccess = async (
  client: PoolClient,
  channelId: string,
  requestingMemberId: string,
  memberIds: string[],
): Promise<ChannelInfo> => {
  const result = await client.query(
    `
        SELECT 
            c.channel_type,
            cm.role as requesting_user_role,
            COALESCE(
                ARRAY_AGG(existing_cm.workspace_member_id) FILTER (
                    WHERE existing_cm.workspace_member_id IS NOT NULL
                ), 
                ARRAY[]::uuid[]
            ) as existing_member_ids
        FROM channels c
        LEFT JOIN channel_members cm ON c.id = cm.channel_id AND cm.workspace_member_id = $2
        LEFT JOIN channel_members existing_cm ON c.id = existing_cm.channel_id 
            AND existing_cm.workspace_member_id = ANY($3::uuid[])
        WHERE c.id = $1
        GROUP BY c.id, c.channel_type, cm.role
    `,
    [channelId, requestingMemberId, memberIds],
  );

  if (result.rows.length === 0) {
    throw ChannelError.notFound();
  }

  const row = result.rows[0];

  // For private channels, user must be a member to add others
  // For public channels, any workspace member can add members
  if (row.channel_type === PRIVATE_CHANNEL_TYPE && !row.requesting_user_role) {
    throw ChannelError.notMember();
  }

  return {
    channelType: row.channel_type,
    requestingUserRole: row.requesting_user_role,
    existingMemberIds: row.existing_member_ids || [],
  };
};

const validateWorkspaceMembers = async (
  client: PoolClient,
  memberIds: string[],
  workspaceId: string,
): Promise<string[]> => {
  const validMembersResult = await client.query(
    `SELECT id FROM workspace_members 
         WHERE id = ANY($1::uuid[]) AND workspace_id = $2 AND is_deactivated = false`,
    [memberIds, workspaceId],
  );

  const validIds = validMembersResult.rows.map((row) => row.id);
  const invalidIds = memberIds.filter((id) => !validIds.includes(id));

  if (invalidIds.length > 0) {
    throw ChannelError.invalidMembers(invalidIds);
  }

  return validIds;
};

const inviteMembersToChannel = async (
  client: PoolClient,
  channelId: string,
  memberIds: string[],
): Promise<void> => {
  if (memberIds.length === 0) {
    console.error('No members to invite');
    return;
  }

  await client.query(
    `
        INSERT INTO channel_members (channel_id, workspace_member_id, role)
        SELECT $1::uuid, unnest($2::uuid[]), $3::text
    `,
    [channelId, memberIds, CHANNEL_MEMBER_ROLE],
  );
};

export const handler = withCors(async (event: APIGatewayProxyEvent, context: Context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  let params, body;
  try {
    params = pathParamsSchema.parse(event.pathParameters);
    body = inviteMembersRequestSchema.parse(JSON.parse(event.body || '{}'));
  } catch (err) {
    if (err instanceof ZodError) {
      return errorResponse('Validation failed', 400, {}, { errors: err.errors });
    }
    return errorResponse('Invalid JSON', 400);
  }

  const { workspaceId, channelId } = params;
  const { memberIds } = body;

  const userId = await getUserIdFromToken(
    event.headers.Authorization || event.headers.authorization,
  );
  if (!userId) {
    throw new AuthError();
  }

  const client = await dbPool.connect();
  let inTx = false;
  try {
    const workspaceMember = await getWorkspaceMember(client, workspaceId, userId);
    if (!workspaceMember) {
      return errorResponse('Not a workspace member', 403);
    }

    const info = await getChannelInfoAndValidateAccess(
      client,
      channelId,
      workspaceMember.id,
      memberIds,
    );
    if (info.channelType === PRIVATE_CHANNEL_TYPE && info.requestingUserRole !== ADMIN_ROLE) {
      return errorResponse('Only admins can invite to private channels', 403);
    }

    const existing = new Set(info.existingMemberIds);
    const toInvite = memberIds.filter((id) => !existing.has(id));
    if (toInvite.length === 0) {
      return errorResponse('All users already invited', 409);
    }

    const validIds = await validateWorkspaceMembers(client, toInvite, workspaceId);

    await client.query('BEGIN');
    inTx = true;
    await inviteMembersToChannel(client, channelId, validIds);
    await client.query('COMMIT');
    inTx = false;

    return successResponse({
      success: true,
      invitedMembers: validIds.length,
      skippedMembers: existing.size,
      totalRequested: memberIds.length,
      newMemberIds: validIds,
    });
  } catch (error) {
    if (client && inTx) {
      await client.query('ROLLBACK');
    }
    console.error('Invite error', {
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      workspaceId,
      channelId,
      memberCount: memberIds.length,
    });

    if (error instanceof ApplicationError) {
      return errorResponse(error.message, error.statusCode, error.data);
    }

    if (error instanceof DatabaseError) {
      switch (error.code) {
        case '23503':
          return errorResponse('Invalid channel or member reference', 400);
        case '23505':
          return errorResponse('One or more members are already in the channel', 409);
        case '23514':
          return errorResponse('Invalid data provided', 400);
      }
    }

    return errorResponse('Internal server error', 500);
  } finally {
    client?.release();
  }
});
