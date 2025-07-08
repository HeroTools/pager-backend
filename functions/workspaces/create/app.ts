import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { PoolClient } from 'pg';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { errorResponse, successResponse } from '../../common/utils/response';
import dbPool from '../../common/utils/create-db-pool';

interface CreateWorkspaceBody {
    name: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
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

        const { name } = body;
        if (!name?.trim() || name.trim().length < 3) {
            return errorResponse('Name is required and must be at least 3 characters long', 400);
        }

        const trimmedName = name.trim();

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
                SELECT 'general', workspace_id, 'public', 'This is the one channel that will always include everyone. It's a great place for announcements and team-wide conversations.', true FROM new_member
                RETURNING id, workspace_id
            ),
            channel_membership AS (
                INSERT INTO channel_members (workspace_member_id, channel_id, role, notifications_enabled)
                SELECT nm.id, nc.id, 'admin', true 
                FROM new_member nm, new_channel nc
            )
            SELECT 
                nw.id as workspace_id,
                nm.id as member_id,
                nc.id as channel_id
            FROM new_workspace nw, new_member nm, new_channel nc
            `,
            [trimmedName, userId],
        );

        const workspaceData = result.rows[0];

        return successResponse({
            id: workspaceData.workspace_id,
            name: trimmedName,
            role: 'admin',
            workspaceMemberId: workspaceData.member_id,
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
                case '23503': // Foreign key violation
                    return errorResponse('Invalid user reference', 400);
                case '23514': // Check constraint violation
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
};
