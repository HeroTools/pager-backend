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

// Helper to get channel/conversation members for targeted notifications
const getChannelMembers = async (channelId: string) => {
    const { data, error } = await supabase
        .from('channel_members')
        .select(
            `
            workspace_member_id,
            workspace_members!inner (
                users!inner (
                    id
                )
            )
        `,
        )
        .eq('channel_id', channelId);

    if (error) {
        console.error('Error fetching channel members:', error);
        return [];
    }

    return data.map((member) => member.workspace_members.users.id);
};

const getConversationMembers = async (conversationId: string) => {
    const { data, error } = await supabase
        .from('conversation_members')
        .select(
            `
            workspace_member_id,
            workspace_members!inner (
                users!inner (
                    id
                )
            )
        `,
        )
        .eq('conversation_id', conversationId)
        .is('left_at', null);

    if (error) {
        console.error('Error fetching conversation members:', error);
        return [];
    }

    return data.map((member) => member.workspace_members.users.id);
};

export { getWorkspaceMember, getChannelMembers, getConversationMembers };
