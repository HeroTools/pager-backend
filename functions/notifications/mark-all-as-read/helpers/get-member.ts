import { PoolClient } from 'pg';

const getWorkspaceMember = async (client: PoolClient, workspaceId: string, userId: string) => {
    const workspaceMemberQuery = `
    SELECT id FROM workspace_members 
    WHERE workspace_id = $1 AND user_id = $2 AND is_deactivated = false
    `;
    const { rows: memberRows } = await client.query(workspaceMemberQuery, [workspaceId, userId]);

    return memberRows[0];
};

export { getWorkspaceMember };
