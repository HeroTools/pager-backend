import { PoolClient } from 'pg';

const getWorkspaceMember = async (client: PoolClient, workspaceId: string, userId: string) => {
    const result = await client.query(
        `
    SELECT *
    FROM workspace_members
    WHERE workspace_id = $1
      AND user_id      = $2
      AND is_deactivated = false
    LIMIT 1
    `,
        [workspaceId, userId],
    );

    return result.rows[0] || null;
};

export { getWorkspaceMember };
