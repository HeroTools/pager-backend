import { supabase } from '../utils/supabase-client';

const getWorkspaceMember = async (workspaceId: string, userId: string) => {
    const { data: member } = await supabase
        .from('workspace_members')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .single();

    return member;
};

export { getWorkspaceMember };
