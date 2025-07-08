import { APIGatewayProxyHandler } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getMember } from '../../common/helpers/get-member';
import dbPool from '../../common/utils/create-db-pool';
import { successResponse, errorResponse } from '../../common/utils/response';

export const handler: APIGatewayProxyHandler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  let client;

  try {
    const userId = await getUserIdFromToken(event.headers.Authorization);
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const workspaceId = event.pathParameters?.workspaceId;
    if (!workspaceId) {
      return errorResponse('Workspace ID is required', 400);
    }

    const member = await getMember(workspaceId, userId);
    if (!member) {
      return errorResponse('Not a member of this workspace', 403);
    }

    const query = `
            SELECT
                c.id,
                c.name,
                c.workspace_id,
                c.created_at,
                c.updated_at,
                c.channel_type,
                c.description,
                c.settings,

                -- info about *this* user’s membership
                cm.id                             AS member_id,
                cm.role                           AS member_role,
                cm.joined_at                      AS member_joined_at,
                cm.notifications_enabled          AS member_notifications_enabled,
                cm.last_read_message_id           AS member_last_read_message_id,
                (cm.id IS NOT NULL)               AS is_member,

                -- total count of channel_members for this channel
                COALESCE(cnt.member_count, 0)     AS member_count

            FROM channels c

            -- grab *this* workspace‐member’s row (if any)
            LEFT JOIN channel_members cm
              ON c.id = cm.channel_id
             AND cm.workspace_member_id = $2

            -- pre‐aggregate total members per channel
            LEFT JOIN (
                SELECT channel_id, COUNT(*) AS member_count
                  FROM channel_members
                 GROUP BY channel_id
            ) cnt
              ON cnt.channel_id = c.id

            WHERE c.workspace_id = $1
              AND c.deleted_at IS NULL
              AND (
                   c.channel_type = 'public'
                   OR cm.workspace_member_id = $2
              )
            ORDER BY c.created_at ASC
        `;

    client = await dbPool.connect();
    const result = await client.query(query, [workspaceId, member.id]);

    const channels = result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      workspace_id: row.workspace_id,
      created_at: row.created_at,
      updated_at: row.updated_at,
      channel_type: row.channel_type,
      description: row.description,
      settings: row.settings,
      is_member: row.is_member,
      member_count: Number(row.member_count),
      member_info: row.is_member
        ? {
            id: row.member_id,
            role: row.member_role,
            joined_at: row.member_joined_at,
            notifications_enabled: row.member_notifications_enabled,
            last_read_message_id: row.member_last_read_message_id,
          }
        : null,
    }));

    return successResponse(channels);
  } catch (error) {
    console.error('Error getting available channels:', error);
    return errorResponse('Internal server error', 500);
  } finally {
    if (client) {
      client.release();
    }
  }
};
