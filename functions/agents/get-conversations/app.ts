import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import { getMember } from '../../../common/helpers/get-member';
import { withCors } from '../../../common/utils/cors';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

const pathParamsSchema = z.object({
  workspaceId: z.string().uuid('Invalid workspace ID format'),
  agentId: z.string().uuid('Invalid agent ID format'),
});

const queryParamsSchema = z.object({
  include_hidden: z
    .string()
    .optional()
    .transform((val) => val === 'true'),
  limit: z
    .string()
    .optional()
    .transform((val) => {
      if (!val) return 20;
      const parsed = parseInt(val, 10);
      if (isNaN(parsed) || parsed < 1 || parsed > 100) {
        throw new Error('Limit must be between 1 and 100');
      }
      return parsed;
    }),
  cursor: z.string().datetime().optional(),
});

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client;
    try {
      // 1) Auth check
      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) return errorResponse('Unauthorized', 401);

      // 2) Validate path parameters
      const pathParamsResult = pathParamsSchema.safeParse(event.pathParameters);
      if (!pathParamsResult.success) {
        return errorResponse(
          `Invalid path parameters: ${pathParamsResult.error.issues.map((i) => i.message).join(', ')}`,
          400,
        );
      }
      const { workspaceId, agentId } = pathParamsResult.data;

      // 3) Validate query parameters
      const queryParamsResult = queryParamsSchema.safeParse(event.queryStringParameters || {});
      if (!queryParamsResult.success) {
        return errorResponse(
          `Invalid query parameters: ${queryParamsResult.error.issues.map((i) => i.message).join(', ')}`,
          400,
        );
      }
      const { include_hidden: includeHidden, limit, cursor } = queryParamsResult.data;

      // 4) Workspace membership check
      const currentMember = await getMember(workspaceId, userId);
      if (!currentMember) return errorResponse('Not a member of this workspace', 403);

      client = await dbPool.connect();

      // 5) Verify agent exists and is in this workspace
      const agentCheckQuery = `
        SELECT id, name, avatar_url, is_active
        FROM agents
        WHERE id = $1 AND workspace_id = $2
      `;

      const agentResult = await client.query(agentCheckQuery, [agentId, workspaceId]);

      if (agentResult.rows.length === 0) {
        return errorResponse('Agent not found in this workspace', 404);
      }

      const agent = agentResult.rows[0];

      // 6) Get conversations between the user and this specific agent
      const conversationsQuery = `
        SELECT
          c.id,
          c.workspace_id,
          c.created_at,
          c.updated_at,
          c.title,
          user_cm.last_read_message_id,
          user_cm.is_hidden,
          -- Get last message info for preview
          lm.body as last_message_body,
          lm.created_at as last_message_at,
          lm.sender_type as last_message_sender_type,
          CASE
            WHEN lm.sender_type = 'user' THEN u.name
            WHEN lm.sender_type = 'agent' THEN a.name
            ELSE 'System'
          END as last_message_sender_name
        FROM conversations c
        INNER JOIN conversation_members user_cm ON c.id = user_cm.conversation_id
        INNER JOIN conversation_members agent_cm ON c.id = agent_cm.conversation_id
        LEFT JOIN messages lm ON c.id = lm.conversation_id
        LEFT JOIN users u ON lm.workspace_member_id = (
          SELECT wm.id FROM workspace_members wm WHERE wm.user_id = u.id AND wm.workspace_id = c.workspace_id
        )
        LEFT JOIN agents a ON lm.ai_agent_id = a.id
        WHERE c.workspace_id = $1
          AND user_cm.workspace_member_id = $2
          AND user_cm.left_at IS NULL
          AND agent_cm.ai_agent_id = $3
          AND agent_cm.left_at IS NULL
          ${!includeHidden ? 'AND user_cm.is_hidden = false' : ''}
          ${cursor ? 'AND c.updated_at < $5' : ''}
          AND (lm.id IS NULL OR lm.id = (
            SELECT m.id FROM messages m
            WHERE m.conversation_id = c.id
            ORDER BY m.created_at DESC
            LIMIT 1
          ))
        ORDER BY c.updated_at DESC
        LIMIT $4
      `;

      const queryParams = [workspaceId, currentMember.id, agentId, limit + 1]; // +1 to check if there's more
      if (cursor) {
        queryParams.push(cursor);
      }

      const conversationsResult = await client.query(conversationsQuery, queryParams);

      // 4) Check if there are more results (we fetched limit + 1)
      const hasMore = conversationsResult.rows.length > limit;
      const conversations = conversationsResult.rows.slice(0, limit); // Remove the extra item

      // 5) Get next cursor (last item's updated_at)
      const nextCursor =
        conversations.length > 0 ? conversations[conversations.length - 1].updated_at : null;

      // 6) Transform to frontend format
      const transformedConversations = conversations.map((row) => ({
        id: row.id,
        workspace_id: row.workspace_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
        title: row.title,
        last_read_message_id: row.last_read_message_id,
        is_hidden: row.is_hidden,
        last_message: row.last_message_body
          ? {
              body: row.last_message_body,
              created_at: row.last_message_at,
              sender_type: row.last_message_sender_type,
              sender_name: row.last_message_sender_name,
            }
          : null,
      }));

      const response = {
        agent: {
          id: agent.id,
          name: agent.name,
          avatar_url: agent.avatar_url,
          is_active: agent.is_active,
        },
        conversations: transformedConversations,
        pagination: {
          limit,
          hasMore,
          nextCursor: hasMore ? nextCursor : null,
        },
      };

      return successResponse(response, 200);
    } catch (err) {
      console.error('Error getting agent conversations:', err);
      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
