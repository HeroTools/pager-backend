import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import dbPool from '../../../common/utils/create-db-pool';
import { MultiUserAgentConversationCreateRequest, MultiUserAgentConversationResponse } from '../types';

const CreateMultiUserConversationRequest = z.object({
  agentId: z.string().uuid(),
  title: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  isPublic: z.boolean().default(false),
  initialUserIds: z.array(z.string().uuid()).optional().default([]),
});

function generateInviteCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  let client: PoolClient | null = null;

  try {
    const authHeader = event.headers.authorization || event.headers.Authorization;
    const workspaceId = event.pathParameters?.workspaceId;

    if (!authHeader || !workspaceId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing required parameters' }),
      };
    }

    const body = CreateMultiUserConversationRequest.parse(JSON.parse(event.body || '{}'));
    
    client = await dbPool.connect();
    const userId = await getUserIdFromToken(authHeader);

    if (!userId) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    // Get workspace member
    const workspaceMemberResult = await client.query(
      `SELECT id FROM workspace_members 
       WHERE user_id = $1 AND workspace_id = $2 AND is_deactivated = false`,
      [userId, workspaceId]
    );

    if (workspaceMemberResult.rows.length === 0) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'User not found in workspace' }),
      };
    }

    const workspaceMemberId = workspaceMemberResult.rows[0].id;

    // Verify agent exists and is active
    const agentResult = await client.query(
      `SELECT id, name, avatar_url, is_active 
       FROM agents 
       WHERE id = $1 AND workspace_id = $2 AND is_active = true`,
      [body.agentId, workspaceId]
    );

    if (agentResult.rows.length === 0) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Agent not found or inactive' }),
      };
    }

    const agent = agentResult.rows[0];

    // Verify initial users exist in workspace (if provided)
    if (body.initialUserIds.length > 0) {
      const usersResult = await client.query(
        `SELECT id FROM workspace_members 
         WHERE id = ANY($1) AND workspace_id = $2 AND is_deactivated = false`,
        [body.initialUserIds, workspaceId]
      );

      if (usersResult.rows.length !== body.initialUserIds.length) {
        return {
          statusCode: 400,
          body: JSON.stringify({ error: 'Some users not found in workspace' }),
        };
      }
    }

    await client.query('BEGIN');

    try {
      // Create conversation
      const conversationResult = await client.query(
        `INSERT INTO conversations (
          workspace_id, 
          title, 
          description, 
          conversation_type, 
          is_public, 
          creator_workspace_member_id
        ) VALUES ($1, $2, $3, 'multi_user_agent', $4, $5) 
        RETURNING *`,
        [workspaceId, body.title, body.description || null, body.isPublic, workspaceMemberId]
      );

      const conversation = conversationResult.rows[0];

      // Add creator as member with creator role
      await client.query(
        `INSERT INTO conversation_members (
          conversation_id, 
          workspace_member_id, 
          role, 
          joined_at
        ) VALUES ($1, $2, 'creator', NOW())`,
        [conversation.id, workspaceMemberId]
      );

      // Add agent as member
      await client.query(
        `INSERT INTO conversation_members (
          conversation_id, 
          ai_agent_id, 
          role, 
          joined_at
        ) VALUES ($1, $2, 'agent', NOW())`,
        [conversation.id, body.agentId]
      );

      // Add initial users as members
      for (const userId of body.initialUserIds) {
        await client.query(
          `INSERT INTO conversation_members (
            conversation_id, 
            workspace_member_id, 
            role, 
            joined_at
          ) VALUES ($1, $2, 'member', NOW())`,
          [conversation.id, userId]
        );
      }

      // Generate invite code if public
      let inviteCode: string | undefined;
      if (body.isPublic) {
        let codeGenerated = false;
        let attempts = 0;
        
        while (!codeGenerated && attempts < 10) {
          inviteCode = generateInviteCode();
          try {
            await client.query(
              `INSERT INTO conversation_invites (
                conversation_id, 
                invited_by_workspace_member_id, 
                invite_code
              ) VALUES ($1, $2, $3)`,
              [conversation.id, workspaceMemberId, inviteCode]
            );
            codeGenerated = true;
          } catch (error: any) {
            if (error.code === '23505') { // unique violation
              attempts++;
              continue;
            }
            throw error;
          }
        }

        if (!codeGenerated) {
          throw new Error('Failed to generate unique invite code');
        }
      }

      // Get all members with user details
      const membersResult = await client.query(
        `SELECT 
          cm.id,
          cm.role,
          cm.joined_at,
          u.id as user_id,
          u.name as user_name,
          u.image as user_image
        FROM conversation_members cm
        LEFT JOIN workspace_members wm ON cm.workspace_member_id = wm.id
        LEFT JOIN users u ON wm.user_id = u.id
        WHERE cm.conversation_id = $1 AND cm.workspace_member_id IS NOT NULL
        ORDER BY cm.joined_at`,
        [conversation.id]
      );

      const members = membersResult.rows.map(row => ({
        id: row.id,
        role: row.role,
        joined_at: row.joined_at,
        user: {
          id: row.user_id,
          name: row.user_name,
          image: row.user_image,
        },
      }));

      await client.query('COMMIT');

      const response: MultiUserAgentConversationResponse = {
        conversation: {
          id: conversation.id,
          workspace_id: conversation.workspace_id,
          title: conversation.title,
          description: conversation.description,
          conversation_type: 'multi_user_agent',
          is_public: conversation.is_public,
          creator_workspace_member_id: conversation.creator_workspace_member_id,
          created_at: conversation.created_at,
          updated_at: conversation.updated_at,
        },
        agent: {
          id: agent.id,
          name: agent.name,
          avatar_url: agent.avatar_url,
          is_active: agent.is_active,
        },
        members,
        ...(inviteCode && { invite_code: inviteCode }),
      };

      return {
        statusCode: 201,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(response),
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

  } catch (error: any) {
    console.error('Error creating multi-user agent conversation:', error);
    
    if (error.name === 'ZodError') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid request data', details: error.errors }),
      };
    }

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  } finally {
    if (client) {
      client.release();
    }
  }
};