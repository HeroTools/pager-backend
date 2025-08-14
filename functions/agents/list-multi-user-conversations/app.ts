import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PoolClient } from 'pg';
import { z } from 'zod';
import { getUserIdFromToken } from '../../../common/helpers/auth';
import dbPool from '../../../common/utils/create-db-pool';

const ListMultiUserConversationsRequest = z.object({
  includePrivate: z.boolean().default(false),
  limit: z.number().min(1).max(50).default(20),
  offset: z.number().min(0).default(0),
});

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

    const queryParams = event.queryStringParameters || {};
    const body = ListMultiUserConversationsRequest.parse({
      includePrivate: queryParams.includePrivate === 'true',
      limit: queryParams.limit ? parseInt(queryParams.limit) : 20,
      offset: queryParams.offset ? parseInt(queryParams.offset) : 0,
    });
    
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

    // Build query based on whether to include private conversations
    let whereClause = `c.workspace_id = $1 AND c.conversation_type = 'multi_user_agent'`;
    const queryParams_: any[] = [workspaceId];

    if (!body.includePrivate) {
      // Only show public conversations
      whereClause += ` AND c.is_public = true`;
    } else {
      // Show public conversations + private conversations the user is a member of
      whereClause += ` AND (c.is_public = true OR EXISTS (
        SELECT 1 FROM conversation_members cm2 
        WHERE cm2.conversation_id = c.id 
        AND cm2.workspace_member_id = $${queryParams_.length + 1}
      ))`;
      queryParams_.push(workspaceMemberId);
    }

    const conversationsResult = await client.query(
      `SELECT 
        c.id,
        c.workspace_id,
        c.title,
        c.description,
        c.conversation_type,
        c.is_public,
        c.creator_workspace_member_id,
        c.created_at,
        c.updated_at,
        a.id as agent_id,
        a.name as agent_name,
        a.avatar_url as agent_avatar_url,
        a.is_active as agent_is_active,
        creator_u.name as creator_name,
        creator_u.image as creator_image,
        COUNT(cm_users.id) as member_count,
        CASE 
          WHEN user_cm.id IS NOT NULL THEN true 
          ELSE false 
        END as is_member
      FROM conversations c
      LEFT JOIN conversation_members cm_agent ON c.id = cm_agent.conversation_id AND cm_agent.ai_agent_id IS NOT NULL
      LEFT JOIN agents a ON cm_agent.ai_agent_id = a.id
      LEFT JOIN workspace_members creator_wm ON c.creator_workspace_member_id = creator_wm.id
      LEFT JOIN users creator_u ON creator_wm.user_id = creator_u.id
      LEFT JOIN conversation_members cm_users ON c.id = cm_users.conversation_id AND cm_users.workspace_member_id IS NOT NULL
      LEFT JOIN conversation_members user_cm ON c.id = user_cm.conversation_id AND user_cm.workspace_member_id = $${queryParams_.length + 1}
      WHERE ${whereClause}
      GROUP BY c.id, a.id, creator_u.id, user_cm.id
      ORDER BY c.updated_at DESC
      LIMIT $${queryParams_.length + 2}
      OFFSET $${queryParams_.length + 3}`,
      [...queryParams_, workspaceMemberId, body.limit, body.offset]
    );

    const conversations = conversationsResult.rows.map(row => ({
      conversation: {
        id: row.id,
        workspace_id: row.workspace_id,
        title: row.title,
        description: row.description,
        conversation_type: row.conversation_type,
        is_public: row.is_public,
        creator_workspace_member_id: row.creator_workspace_member_id,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
      agent: {
        id: row.agent_id,
        name: row.agent_name,
        avatar_url: row.agent_avatar_url,
        is_active: row.agent_is_active,
      },
      creator: {
        name: row.creator_name,
        image: row.creator_image,
      },
      member_count: parseInt(row.member_count),
      is_member: row.is_member,
    }));

    // Get total count for pagination
    const countResult = await client.query(
      `SELECT COUNT(*) as total
       FROM conversations c
       WHERE ${whereClause}`,
      queryParams_.slice(0, -2) // Remove limit and offset
    );

    const totalCount = parseInt(countResult.rows[0].total);
    const hasMore = body.offset + body.limit < totalCount;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        conversations,
        pagination: {
          limit: body.limit,
          offset: body.offset,
          total: totalCount,
          hasMore,
        },
      }),
    };

  } catch (error: any) {
    console.error('Error listing multi-user conversations:', error);
    
    if (error.name === 'ZodError') {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid request parameters', details: error.errors }),
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