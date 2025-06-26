import { supabase } from '../utils/supabase-client';

interface ChannelMember {
    role: string;
}

export const getChannelMember = async (
    channelId: string,
    userId: string,
    workspaceId: string,
): Promise<ChannelMember | null> => {
    try {
        const { data: workspaceMember, error: workspaceMemberError } = await supabase
            .from('workspace_members')
            .select('id')
            .eq('user_id', userId)
            .eq('workspace_id', workspaceId)
            .single();

        if (workspaceMemberError || !workspaceMember) {
            return null;
        }

        const { data: member, error: memberError } = await supabase
            .from('channel_members')
            .select('role')
            .eq('channel_id', channelId)
            .eq('workspace_member_id', workspaceMember.id)
            .single();

        if (memberError || !member) {
            return null;
        }

        return member;
    } catch (error) {
        console.error('Error fetching channel member:', error);
        return null;
    }
};
