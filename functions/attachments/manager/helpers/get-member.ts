import { supabase } from '../utils/supabase-client';

const getMember = async (workspaceId: string, userId: string) => {
    const { data: workspaceMember, error: memberError } = await supabase
        .from('workspace_members')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .eq('is_deactivated', false)
        .single();

    return { workspaceMember, memberError };
};

export { getMember };
