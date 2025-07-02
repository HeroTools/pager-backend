import { z } from 'zod';
import { PoolClient } from 'pg';

const deletionResultSchema = z.object({
    messageId: z.string().uuid(),
    deletedAt: z.string().datetime(),
    messagesDeleted: z.number().int().min(0),
    reactionsDeleted: z.number().int().min(0),
    attachmentsOrphaned: z.number().int().min(0),
    cascade: z.boolean(),
});

type DeletionResult = z.infer<typeof deletionResultSchema>;

export const softDeleteOnlyParent = async (
    client: PoolClient,
    messageId: string,
    deletedAt: string,
): Promise<DeletionResult> => {
    try {
        await client.query('BEGIN');

        // 1) Delete reactions for the parent
        const reactionsRes = await client.query(`DELETE FROM reactions WHERE message_id = $1`, [messageId]);
        const reactionsDeleted = reactionsRes.rowCount;

        // 2) Orphan & delete attachments
        const { rows: atts } = await client.query(
            `SELECT uploaded_file_id
            FROM message_attachments
            WHERE message_id = $1`,
            [messageId],
        );
        const fileIds = atts.map((r) => r.uploaded_file_id);

        let attachmentsOrphaned = 0;
        if (fileIds.length > 0) {
            const orphanRes = await client.query(
                `UPDATE uploaded_files
                SET status     = 'orphaned',
                    updated_at = $1
                WHERE id = ANY($2::uuid[])
                AND status != 'orphaned'`,
                [deletedAt, fileIds],
            );
            attachmentsOrphaned = orphanRes?.rowCount || 0;

            await client.query(`DELETE FROM message_attachments WHERE message_id = $1`, [messageId]);
        }

        // 3) Soft-delete the parent message only
        const msgRes = await client.query(
            `UPDATE messages
            SET deleted_at = $1,
                updated_at = $1
            WHERE id = $2
            AND deleted_at IS NULL`,
            [deletedAt, messageId],
        );
        const messagesDeleted = msgRes?.rowCount || 0;

        // 4) Mark related notifications as read
        await client.query(
            `UPDATE notifications
            SET is_read = true,
                read_at  = $1
            WHERE related_message_id = $2
            AND is_read = false`,
            [deletedAt, messageId],
        );

        await client.query('COMMIT');

        return deletionResultSchema.parse({
            messageId,
            deletedAt,
            messagesDeleted,
            reactionsDeleted,
            attachmentsOrphaned,
            cascade: false,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    }
};
