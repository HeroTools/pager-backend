import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client;
    try {
      // 1) Auth & workspace check
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) return errorResponse('Unauthorized', 401);

      const workspaceId = event.pathParameters?.workspaceId;
      if (!workspaceId) return errorResponse('Workspace ID is required', 400);

      const includeHidden = event.queryStringParameters?.include_hidden === 'true';
      const currentMember = await getMember(workspaceId, userId);
      if (!currentMember) return errorResponse('Not a member of this workspace', 403);

      client = await dbPool.connect();

      // 2) First get conversation IDs where user is a member (human-only conversations)
      const conversationIdsQuery = `
        SELECT DISTINCT c.id, c.updated_at
        FROM conversations c
        INNER JOIN conversation_members cm ON c.id = cm.conversation_id
        WHERE c.workspace_id = $1
          AND cm.workspace_member_id = $2
          AND cm.left_at IS NULL
          ${!includeHidden ? 'AND cm.is_hidden = false' : ''}
          -- Exclude conversations that have ANY AI agent members
          AND NOT EXISTS (
            SELECT 1 FROM conversation_members cm_agent
            WHERE cm_agent.conversation_id = c.id
            AND cm_agent.ai_agent_id IS NOT NULL
          )
        ORDER BY c.updated_at DESC
      `;

      const conversationIdsResult = await client.query(conversationIdsQuery, [
        workspaceId,
        currentMember.id,
      ]);

      if (conversationIdsResult.rows.length === 0) {
        return successResponse([], 200);
      }

      const conversationIds = conversationIdsResult.rows.map((row) => row.id);

      // 3) Get full conversation data with members
      const conversationsQuery = `
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
        WHERE c.id = ANY($1)
          AND cm.left_at IS NULL
          AND cm.workspace_member_id IS NOT NULL
        GROUP BY c.id, c.workspace_id, c.created_at, c.updated_at, c.title
        ORDER BY c.updated_at DESC
      `;

      const result = await client.query(conversationsQuery, [conversationIds]);

      if (result.rows.length === 0) {
        return successResponse([], 200);
      }

      // 4) Transform to frontend format
      const conversations = result.rows.map((row) => {
        const members = row.members.map((member: any) => ({
          id: member.id,
          joined_at: member.joined_at,
          role: member.workspace_member.role,
          notifications_enabled: true,
          left_at: member.left_at,
          is_hidden: member.is_hidden,
          last_read_message_id: member.last_read_message_id,
          workspace_member: member.workspace_member,
        }));

        const other_members = members.filter((m: any) => m.workspace_member?.user.id !== userId);
        const member_count = members.length;

        return {
          id: row.id,
          workspace_id: row.workspace_id,
          created_at: row.created_at,
          updated_at: row.updated_at,
          title: row.title,
          members,
          member_count,
          other_members,
          is_group_conversation: member_count > 2,
        };
      });

      return successResponse(conversations, 200);
    } catch (err) {
      console.error('Error getting conversations:', err);
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
