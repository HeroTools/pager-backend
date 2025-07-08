import { ScheduledHandler } from 'aws-lambda';
import { SQSClient, SendMessageBatchCommand, SendMessageBatchRequestEntry } from '@aws-sdk/client-sqs';
import { successResponse, errorResponse } from '../../common/utils/response';
import dbPool from '../../common/utils/create-db-pool';

const sqs = new SQSClient({});
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '100');
const MAX_MESSAGES_PER_RUN = parseInt(process.env.MAX_MESSAGES_PER_RUN || '1000');
const SQS_QUEUE_URL = process.env.SQS_QUEUE_URL!;
const SQS_BATCH_SIZE = 10;

interface MessageToEmbed {
    id: string;
    workspace_id: string;
    channel_id: string | null;
    conversation_id: string | null;
    parent_message_id: string | null;
    created_at: string;
    body: string;
    text: string | null;
}

interface WorkspaceBatch {
    workspace_id: string;
    messages: MessageToEmbed[];
}

export const handler: ScheduledHandler = async (event, context) => {
    console.log('Embedding orchestrator started');

    try {
        const messages = await fetchAndClaimMessages();
        if (messages.length === 0) {
            console.log('No messages to embed');
            return successResponse({ message: 'No messages to embed', data: { processedCount: 0 } });
        }

        console.log(`Claimed ${messages.length} messages for embedding`);
        const workspaceBatches = groupMessagesByWorkspace(messages);
        const { batchCount, failures } = await sendToSQS(workspaceBatches);

        console.log('Orchestration complete', { total: messages.length, batches: batchCount, failures });
        return successResponse({
            message: 'Embedding orchestrator completed',
            data: {
                processedCount: messages.length,
                workspaceCount: workspaceBatches.length,
                sqsBatches: batchCount,
                failures,
            },
        });
    } catch (err: any) {
        console.error('Orchestrator error:', err);
        return errorResponse(err.message || 'Unknown error', 500);
    }
};

async function fetchAndClaimMessages(): Promise<MessageToEmbed[]> {
    const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
    const claimTimestamp = new Date();

    const query = `
        UPDATE messages 
        SET claimed_at = $1
        WHERE id IN (
            SELECT id 
            FROM messages 
            WHERE needs_embedding = true 
            AND deleted_at IS NULL
            AND (claimed_at IS NULL OR claimed_at < $2)
            ORDER BY created_at ASC, id ASC
            LIMIT $3
            FOR UPDATE SKIP LOCKED
        )
        RETURNING 
            id, workspace_id, channel_id, conversation_id, 
            parent_message_id, created_at, body, text
    `;

    const client = await dbPool.connect();
    try {
        const result = await client.query(query, [claimTimestamp, staleThreshold, BATCH_SIZE]);
        return result.rows;
    } finally {
        client.release();
    }
}

function groupMessagesByWorkspace(messages: MessageToEmbed[]): WorkspaceBatch[] {
    const map = new Map<string, MessageToEmbed[]>();
    for (const msg of messages) {
        if (msg.text && /\S/.test(msg.text)) {
            const arr = map.get(msg.workspace_id) || [];
            arr.push(msg);
            map.set(msg.workspace_id, arr);
        }
    }
    return Array.from(map, ([workspace_id, msgs]) => ({ workspace_id, messages: msgs })).sort(
        (a, b) => a.messages.length - b.messages.length,
    );
}

async function sendToSQS(workspaceBatches: WorkspaceBatch[]) {
    let batchCount = 0,
        failures = 0;
    const buffer: SendMessageBatchRequestEntry[] = [];

    for (const batch of workspaceBatches) {
        for (const msg of batch.messages) {
            buffer.push({
                Id: msg.id,
                MessageBody: JSON.stringify({
                    messageId: msg.id,
                    workspaceId: msg.workspace_id,
                    channelId: msg.channel_id,
                    conversationId: msg.conversation_id,
                    parentMessageId: msg.parent_message_id,
                    createdAt: msg.created_at,
                    body: msg.body,
                    text: msg.text,
                }),
                MessageAttributes: {
                    workspaceId: { DataType: 'String', StringValue: msg.workspace_id },
                    messageType: { DataType: 'String', StringValue: msg.channel_id ? 'channel' : 'conversation' },
                    isThreadMessage: { DataType: 'String', StringValue: msg.parent_message_id ? 'true' : 'false' },
                },
            });

            if (buffer.length === SQS_BATCH_SIZE) {
                const result = await sendBatch(buffer);
                batchCount++;
                failures += result.failures;
                buffer.length = 0;
            }
        }
    }

    if (buffer.length) {
        const result = await sendBatch(buffer);
        batchCount++;
        failures += result.failures;
    }

    return { batchCount, failures };
}

async function sendBatch(entries: SendMessageBatchRequestEntry[]) {
    try {
        const cmd = new SendMessageBatchCommand({ QueueUrl: SQS_QUEUE_URL, Entries: entries });
        const resp = await sqs.send(cmd);
        const failCount = resp.Failed ? resp.Failed.length : 0;
        if (failCount) console.error('SQS failures:', resp.Failed);
        return { failures: failCount };
    } catch (err) {
        console.error('SQS batch send error:', err);
        return { failures: entries.length };
    }
}
