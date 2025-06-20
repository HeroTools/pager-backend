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

const getChannelMember = async (channelId: string, userId: string) => {
    console.log("im here");
    const { data: member } = await supabase
        .from('channel_members')
        .select('role')
        .eq('channel_id', channelId)
        .eq('workspace_member_id', userId)
        .single();

    return member;
};

export { getWorkspaceMember, getChannelMember };
