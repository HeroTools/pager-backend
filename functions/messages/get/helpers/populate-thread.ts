import { supabase } from '../../../../common/utils/supabase-client';

const populateThread = async (messageId: string) => {
  const { data: messages } = await supabase
    .from('messages')
    .select(
      `
        *,
        members!inner(
          id,
          user_id,
          users!inner(
            id,
            name,
            image
          )
        )
      `,
    )
    .eq('parent_message_id', messageId)
    .order('created_at', { ascending: true });

  if (!messages || messages.length === 0) {
    return {
      count: 0,
      image: undefined,
      timestamp: 0,
      name: '',
    };
  }

  const lastMessage = messages[messages.length - 1];
  const lastMessageUser = lastMessage.members?.users;

  return {
    count: messages.length,
    image: lastMessageUser?.image,
    timestamp: new Date(lastMessage.created_at).getTime(),
    name: lastMessageUser?.name || '',
  };
};

export { populateThread };
