import { supabase } from '../utils/supabase-client';

const getChannelMember = async (channelId: string, userId: string) => {
    // First, get the workspace ID from the channel
    const { data: channel } = await supabase
        .from('channels')
        .select('workspace_id')
        .eq('id', channelId)
        .single();

    if (!channel) {
        return null;
    }

    // Then, get the workspace member ID using the user ID and workspace ID
    const { data: workspaceMember } = await supabase
        .from('workspace_members')
        .select('id')
        .eq('user_id', userId)
        .eq('workspace_id', channel.workspace_id)
        .single();

    if (!workspaceMember) {
        return null;
    }

    // Finally, get the channel member using the channel ID and workspace member ID
    const { data: member } = await supabase
        .from('channel_members')
        .select('role')
        .eq('channel_id', channelId)
        .eq('workspace_member_id', workspaceMember.id)
        .single();

    return member;
};

export { getChannelMember };
