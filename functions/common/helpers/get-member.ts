import { PoolClient } from 'pg';
import { supabase } from '../utils/supabase-client';

export const getMember = async (workspaceId: string, userId: string) => {
    const { data: member } = await supabase
        .from('workspace_members')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .eq('is_deactivated', false)
        .single();

    return member;
};

export const getWorkspaceMember = async (client: PoolClient, workspaceId: string, userId: string) => {
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
