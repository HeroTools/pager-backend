import { supabase } from '../utils/supabase-client';

const getMember = async (workspaceId: string, userId: string) => {
    const { data: member } = await supabase
        .from('workspace_members')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('user_id', userId)
        .eq('is_deactivated', false)
        .single();

    return member;
};

export { getMember };
