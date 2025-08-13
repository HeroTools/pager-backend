import { supabase } from '../../../common/utils/supabase-client';

const populateReactions = async (messageId: string) => {
  const { data: reactions } = await supabase
    .from('reactions')
    .select('*')
    .eq('message_id', messageId);

  if (!reactions) return [];

  // Group reactions by value and count them
  const reactionCounts = reactions.reduce((acc: any[], reaction) => {
    const existing = acc.find((r) => r.value === reaction.value);

    if (existing) {
      existing.count += 1;
      existing.memberIds.push(reaction.member_id);
    } else {
      acc.push({
        ...reaction,
        count: 1,
        memberIds: [reaction.member_id],
      });
    }

    return acc;
  }, []);

  // Remove member_id from the final response
  return reactionCounts.map(({ _member_id, ...rest }) => rest);
};

export { populateReactions };
