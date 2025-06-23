async function getWorkspaceMember(client: any, userId: string, workspaceId: string) {
    const result = await client.query(
        `SELECT id FROM workspace_members 
         WHERE user_id = $1 AND workspace_id = $2 AND is_deactivated = false`,
        [userId, workspaceId],
    );
    return result.rows[0] || null;
}

export { getWorkspaceMember };
