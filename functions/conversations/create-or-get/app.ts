import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getWorkspaceMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

const getFullConversationData = async (client: any, conversationId: string, userId: string) => {
  const query = `
    SELECT
      c.id,
      c.workspace_id,
      c.created_at,
      c.updated_at,
      c.title,
      json_agg(
        json_build_object(
          'id', cm.id,
          'joined_at', cm.joined_at,
          'left_at', cm.left_at,
          'is_hidden', cm.is_hidden,
          'last_read_message_id', cm.last_read_message_id,
          'role', wm.role,
          'notifications_enabled', true,
          'workspace_member', json_build_object(
            'id', wm.id,
            'role', wm.role,
            'user_id', wm.user_id,
            'is_deactivated', wm.is_deactivated,
            'user', json_build_object(
              'id', u.id,
              'name', u.name,
              'image', u.image
            )
          )
        )
      ) as members
    FROM conversations c
    INNER JOIN conversation_members cm ON c.id = cm.conversation_id
    INNER JOIN workspace_members wm ON cm.workspace_member_id = wm.id
    INNER JOIN users u ON wm.user_id = u.id
    WHERE c.id = $1
      AND cm.left_at IS NULL
    GROUP BY c.id, c.workspace_id, c.created_at, c.updated_at, c.title
  `;

  const { rows } = await client.query(query, [conversationId]);
  if (rows.length === 0) return null;

  const conversation = rows[0];
  const members = conversation.members;
  const other_members = members.filter((m: any) => m.workspace_member?.user.id !== userId);

  return {
    id: conversation.id,
    workspace_id: conversation.workspace_id,
    created_at: conversation.created_at,
    updated_at: conversation.updated_at,
    title: conversation.title,
    member_count: members.length,
    is_group_conversation: members.length > 2,
    members,
    other_members,
  };
};

export const handler = withCors(
  async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
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

      // Validate all members exist and are active in one query
      const { rows: validMembers } = await client.query(
        `
        SELECT id, user_id, role, is_deactivated
        FROM workspace_members
        WHERE workspace_id = $1
          AND is_deactivated = false
          AND id = ANY($2)
        `,
        [workspaceId, allMemberIds],
      );

      if (!validMembers || validMembers.length !== allMemberIds.length) {
        return errorResponse('One or more members not found or deactivated', 404);
      }

      // Check for existing conversation (excluding AI agent conversations)
      const findSql = `
        WITH member_conversations AS (
          SELECT DISTINCT cm.conversation_id
          FROM conversation_members cm
          WHERE cm.workspace_member_id = ANY($2)
            AND cm.left_at IS NULL
        ),
        ai_conversations AS (
          SELECT DISTINCT conversation_id
          FROM conversation_members
          WHERE ai_agent_id IS NOT NULL
        ),
        candidates AS (
          SELECT cm.conversation_id
          FROM conversation_members cm
          JOIN conversations c ON c.id = cm.conversation_id
          WHERE c.workspace_id = $1
            AND cm.left_at IS NULL
            AND cm.workspace_member_id = ANY($2)
            AND cm.conversation_id NOT IN (SELECT conversation_id FROM ai_conversations)
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

      const { rows: existingConversation } = await client.query(findSql, [
        workspaceId,
        allMemberIds,
        allMemberIds.length,
      ]);

      // If conversation exists, return full conversation data
      if (existingConversation.length > 0) {
        const fullConversation = await getFullConversationData(
          client,
          existingConversation[0].id,
          userId,
        );
        return successResponse(fullConversation);
      }

      // Create new conversation
      const insertConv = await client.query(
        `INSERT INTO conversations (workspace_id, updated_at)
         VALUES ($1, NOW())
         RETURNING id, created_at, updated_at`,
        [workspaceId],
      );
      const { id: conversationId } = insertConv.rows[0];

      // Insert members
      try {
        await client.query(
          `INSERT INTO conversation_members
           (conversation_id, workspace_member_id, joined_at)
           SELECT $1, unnest($2::uuid[]), NOW()`,
          [conversationId, allMemberIds],
        );
      } catch (err) {
        await client.query(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
        throw err;
      }

      // Get full conversation data for response
      const fullConversation = await getFullConversationData(client, conversationId, userId);
      return successResponse(fullConversation);
    } catch (error) {
      console.error('Error creating/getting conversation:', error);
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
