import { supabase } from './utils/supabase-client';

interface MessageCleanupEvent {
    channelId: string;
}

export const handler = async (event: MessageCleanupEvent): Promise<void> => {
    const { channelId } = event;

    console.log(`Starting message cleanup for channel: ${channelId}`);

    try {
        const batchSize = 1000;
        let deletedCount = 0;
        let hasMore = true;

        while (hasMore) {
            const { data: deletedMessages, error } = await supabase
                .from('messages')
                .delete()
                .eq('channel_id', channelId)
                .limit(batchSize)
                .select('id');

            if (error) {
                throw new Error(`Failed to delete messages: ${error?.message}`);
            }

            const batchDeletedCount = deletedMessages?.length || 0;
            deletedCount += batchDeletedCount;

            if (batchDeletedCount < batchSize) {
                hasMore = false;
            }

            console.log(`Deleted ${batchDeletedCount} messages. Total: ${deletedCount}`);

            if (hasMore) {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
        const { error: hardDeleteError } = await supabase.from('channels').delete().eq('id', channelId);

        if (hardDeleteError) {
            console.error(`Failed to hard delete channel ${channelId}:`, hardDeleteError);
        }

        console.log(`✅ Completed cleanup for channel ${channelId}. Messages deleted: ${deletedCount}`);
    } catch (error) {
        console.error(`❌ Error cleaning up messages for channel ${channelId}:`, error);

        try {
            await supabase
                .from('channels')
                .update({
                    cleanup_error: error?.message,
                    cleanup_attempted_at: new Date().toISOString(),
                })
                .eq('id', channelId);
        } catch (updateError) {
            console.error('Failed to update channel with error status:', updateError);
        }

        throw error;
    }
};
