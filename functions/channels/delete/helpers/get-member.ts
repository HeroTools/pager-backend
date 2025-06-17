import { supabase } from '../utils/supabase-client';

const getChannelMember = async (channelId: string, userId: string) => {
    const { data: member } = await supabase
        .from('channel_members')
        .select('role')
        .eq('channel_id', channelId)
        .eq('workspace_member_id', userId)
        .single();

    return member;
};

export { getChannelMember };
