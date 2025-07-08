import { APIGatewayProxyHandler } from 'aws-lambda';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { getWorkspaceMember } from '../../common/helpers/get-member';
import { successResponse, errorResponse } from '../../common/utils/response';
import dbPool from '../../common/utils/create-db-pool';

export const handler: APIGatewayProxyHandler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  let client;
  try {
    const userId = await getUserIdFromToken(event.headers.Authorization);
    if (!userId) {
      return errorResponse('Unauthorized', 401);
    }

    const { participantMemberIds } = JSON.parse(event.body || '{}');
    if (!participantMemberIds) {
      return errorResponse('participantMemberIds is required', 400);
    }

    const workspaceId = event.pathParameters?.workspaceId;
    if (!workspaceId) {
      return errorResponse('Workspace ID is required', 400);
    }

    client = await dbPool.connect();

    const currentMember = await getWorkspaceMember(client, workspaceId, userId);
    if (!currentMember) {
      return errorResponse('Current member not found', 404);
    }

    const allMemberIds = Array.from(new Set([currentMember.id, ...participantMemberIds]));
    if (allMemberIds.length < 1) {
      return errorResponse('At least one member is required', 400);
    }

    const { rows: members } = await client.query(
      `
            SELECT id
            FROM workspace_members
            WHERE workspace_id = $1
              AND is_deactivated = false
              AND id = ANY($2)
            `,
      [workspaceId, allMemberIds],
    );

    if (!members || members.length !== allMemberIds.length) {
      return errorResponse('One or more members not found or deactivated', 404);
    }

    const findSql = `
      WITH candidates AS (
        SELECT cm.conversation_id
        FROM conversation_members cm
        JOIN conversations c ON c.id = cm.conversation_id
        WHERE c.workspace_id = $1
          AND cm.left_at IS NULL
          AND cm.workspace_member_id = ANY($2)
        GROUP BY cm.conversation_id
        HAVING COUNT(DISTINCT cm.workspace_member_id) = $3
      )
      SELECT c.id
      FROM conversations c
      JOIN candidates cand ON cand.conversation_id = c.id
      WHERE NOT EXISTS (
        SELECT 1
        FROM conversation_members cm2
        WHERE cm2.conversation_id = c.id
          AND cm2.left_at IS NULL
          AND cm2.workspace_member_id <> ALL($2)
      )
      LIMIT 1;
    `;

    const { rows: conversation } = await client.query(findSql, [
      workspaceId,
      allMemberIds,
      allMemberIds.length,
    ]);

    if (conversation.length > 0) {
      return successResponse({ conversation_id: conversation[0].id });
    }

    const insertConv = await client.query(
      `INSERT INTO conversations (workspace_id)
       VALUES ($1)
       RETURNING id`,
      [workspaceId],
    );
    const conversationId = insertConv.rows[0].id;

    try {
      await client.query(
        `INSERT INTO conversation_members
           (conversation_id, workspace_member_id)
         SELECT $1, unnest($2::uuid[])`,
        [conversationId, allMemberIds],
      );
    } catch (err) {
      await client.query(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
      throw err;
    }
    return successResponse({
      id: conversationId,
      member_count: allMemberIds.length,
      update_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      is_group_conversation: allMemberIds.length > 2,
      members: members,
      other_members: members.filter((member) => member.id !== currentMember.id),
    });
  } catch (error) {
    console.error('Error creating/getting conversation:', error);
    return errorResponse('Internal server error', 500);
  } finally {
    if (client) {
      client.release();
    }
  }
};
