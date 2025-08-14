import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import dbPool from '../../../common/utils/create-db-pool';

const JoinConversationRequest = z.object({
  inviteCode: z.string().optional(),
  conversationId: z.string().uuid().optional(),
}).refine(
  (data) => data.inviteCode || data.conversationId,
  { message: 'Either inviteCode or conversationId must be provided' }
);

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

    const body = JoinConversationRequest.parse(JSON.parse(event.body || '{}'));
    
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

    let conversationId: string;
    let isPublicJoin = false;

    if (body.inviteCode) {
      // Join via invite code
      const inviteResult = await client.query(
        `SELECT ci.conversation_id, c.is_public, c.workspace_id
         FROM conversation_invites ci
         JOIN conversations c ON ci.conversation_id = c.id
         WHERE ci.invite_code = $1 
         AND ci.used_at IS NULL 
         AND (ci.expires_at IS NULL OR ci.expires_at > NOW())`,
        [body.inviteCode]
      );

      if (inviteResult.rows.length === 0) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Invalid or expired invite code' }),
        };
      }

      const invite = inviteResult.rows[0];
      
      if (invite.workspace_id !== workspaceId) {
        return {
          statusCode: 403,
          body: JSON.stringify({ error: 'Invite is for a different workspace' }),
        };
      }

      conversationId = invite.conversation_id;
      isPublicJoin = invite.is_public;
    } else {
      // Join public conversation directly
      const conversationResult = await client.query(
        `SELECT id, is_public, conversation_type 
         FROM conversations 
         WHERE id = $1 AND workspace_id = $2 AND is_public = true AND conversation_type = 'multi_user_agent'`,
        [body.conversationId, workspaceId]
      );

      if (conversationResult.rows.length === 0) {
        return {
          statusCode: 404,
          body: JSON.stringify({ error: 'Public conversation not found' }),
        };
      }

      conversationId = conversationResult.rows[0].id;
      isPublicJoin = true;
    }

    // Check if user is already a member
    const existingMemberResult = await client.query(
      `SELECT id FROM conversation_members 
       WHERE conversation_id = $1 AND workspace_member_id = $2`,
      [conversationId, workspaceMemberId]
    );

    if (existingMemberResult.rows.length > 0) {
      return {
        statusCode: 409,
        body: JSON.stringify({ error: 'User is already a member of this conversation' }),
      };
    }

    await client.query('BEGIN');

    try {
      // Add user to conversation
      await client.query(
        `INSERT INTO conversation_members (
          conversation_id, 
          workspace_member_id, 
          role, 
          joined_at
        ) VALUES ($1, $2, 'member', NOW())`,
        [conversationId, workspaceMemberId]
      );

      // Mark invite as used if it was via invite code
      if (body.inviteCode) {
        await client.query(
          `UPDATE conversation_invites 
           SET used_at = NOW() 
           WHERE invite_code = $1`,
          [body.inviteCode]
        );
      }

      await client.query('COMMIT');

      // Get conversation details
      const conversationDetailsResult = await client.query(
        `SELECT 
          c.*,
          a.id as agent_id,
          a.name as agent_name,
          a.avatar_url as agent_avatar_url,
          a.is_active as agent_is_active
        FROM conversations c
        JOIN conversation_members cm ON c.id = cm.conversation_id
        JOIN agents a ON cm.ai_agent_id = a.id
        WHERE c.id = $1`,
        [conversationId]
      );

      const conversation = conversationDetailsResult.rows[0];

      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversation: {
            id: conversation.id,
            workspace_id: conversation.workspace_id,
            title: conversation.title,
            description: conversation.description,
            conversation_type: conversation.conversation_type,
            is_public: conversation.is_public,
            created_at: conversation.created_at,
            updated_at: conversation.updated_at,
          },
          agent: {
            id: conversation.agent_id,
            name: conversation.agent_name,
            avatar_url: conversation.agent_avatar_url,
            is_active: conversation.agent_is_active,
          },
          message: 'Successfully joined conversation',
        }),
      };

    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

  } catch (error: any) {
    console.error('Error joining conversation:', error);
    
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