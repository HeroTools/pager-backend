import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { withCors } from '../../common/utils/cors';
import dbPool from '../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../common/utils/response';

interface CreateWorkspaceBody {
  name: string;
  agentName?: string;
}

export const handler = withCors(
  async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    let client: PoolClient | null = null;

    try {
      if (!event.body) {
        return errorResponse('Request body is required', 400);
      }

      const userId = await getUserIdFromToken(event.headers.Authorization);
      if (!userId) {
        return errorResponse('Unauthorized', 401);
      }

      let body: CreateWorkspaceBody;
      try {
        body = JSON.parse(event.body);
      } catch {
        return errorResponse('Invalid JSON in request body', 400);
      }

      const { name, agentName = 'Assistant' } = body;

      if (!name?.trim() || name.trim().length < 3) {
        return errorResponse('Name is required and must be at least 3 characters long', 400);
      }

      if (agentName && (agentName.trim().length < 2 || agentName.trim().length > 255)) {
        return errorResponse('Agent name must be between 2 and 255 characters', 400);
      }

      const trimmedName = name.trim();
      const trimmedAgentName = agentName.trim();

      client = await dbPool.connect();

      const result = await client.query(
        `
            WITH new_workspace AS (
                INSERT INTO workspaces (name, user_id)
                VALUES ($1, $2)
                RETURNING id
            ),
            new_member AS (
                INSERT INTO workspace_members (user_id, workspace_id, role)
                SELECT $2, id, 'admin' FROM new_workspace
                RETURNING id, workspace_id
            ),
            new_channel AS (
                INSERT INTO channels (name, workspace_id, channel_type, description, is_default)
                SELECT 'general', workspace_id, 'public', 'This is the one channel that will always include everyone. It''s a great place for announcements and team-wide conversations.', true FROM new_member
                RETURNING id, workspace_id
            ),
            channel_membership AS (
                INSERT INTO channel_members (workspace_member_id, channel_id, role, notifications_enabled)
                SELECT nm.id, nc.id, 'admin', true
                FROM new_member nm, new_channel nc
            ),
            new_conversation AS (
                INSERT INTO conversations (workspace_id)
                SELECT workspace_id FROM new_member
                RETURNING id, workspace_id
            ),
            conversation_membership AS (
                INSERT INTO conversation_members (conversation_id, workspace_member_id)
                SELECT nc.id, nm.id
                FROM new_conversation nc, new_member nm
            ),
            new_agent AS (
                INSERT INTO agents (workspace_id, name, description, model, created_by_user_id)
                SELECT workspace_id, $3, 'Default AI assistant for your workspace', 'gpt-4', $2
                FROM new_member
                RETURNING id, name, description, model, avatar_url, is_active, created_at, updated_at
            )
            SELECT
                nw.id as workspace_id,
                nm.id as member_id,
                nc.id as channel_id,
                nconv.id as conversation_id,
                na.id as agent_id,
                na.name as agent_name,
                na.description as agent_description,
                na.model as agent_model,
                na.avatar_url as agent_avatar_url,
                na.is_active as agent_is_active,
                na.created_at as agent_created_at,
                na.updated_at as agent_updated_at
            FROM new_workspace nw, new_member nm, new_channel nc, new_conversation nconv, new_agent na
            `,
        [trimmedName, userId, trimmedAgentName],
      );

      const workspaceData = result.rows[0];

      return successResponse({
        id: workspaceData.workspace_id,
        name: trimmedName,
        role: 'admin',
        workspaceMemberId: workspaceData.member_id,
        defaultAgent: {
          id: workspaceData.agent_id,
          name: workspaceData.agent_name,
          description: workspaceData.agent_description,
          model: workspaceData.agent_model,
          avatar_url: workspaceData.agent_avatar_url,
          is_active: workspaceData.agent_is_active,
          created_at: workspaceData.agent_created_at,
          updated_at: workspaceData.agent_updated_at,
        },
        message: 'Workspace created successfully',
      });
    } catch (error: unknown) {
      console.error('Unexpected error creating workspace:', error);

      if (error instanceof SyntaxError) {
        return errorResponse('Invalid request format', 400);
      }

      if (error && typeof error === 'object' && 'code' in error) {
        const dbError = error as { code: string; detail?: string; constraint?: string };

        switch (dbError.code) {
          case '23505':
            return errorResponse('Workspace name already exists', 409);
          case '23503':
            return errorResponse('Invalid user reference', 400);
          case '23514':
            return errorResponse('Invalid workspace data', 400);
          default:
            console.error('Database error:', dbError);
            return errorResponse('Database operation failed', 500);
        }
      }

      return errorResponse('Internal server error', 500);
    } finally {
      if (client) {
        client.release();
      }
    }
  },
);
