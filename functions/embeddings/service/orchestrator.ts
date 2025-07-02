import { ScheduledHandler } from 'aws-lambda';
import { SQSClient, SendMessageBatchCommand, SendMessageBatchRequestEntry } from '@aws-sdk/client-sqs';
import { supabase } from './utils/supabase-client';
import { errorResponse, successResponse } from './utils/response';

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
    console.log('Embedding orchestrator started', { event });

    try {
        const messages = await fetchMessagesNeedingEmbedding();

        if (messages.length === 0) {
            console.log('No messages need embedding');
            return successResponse({
                message: 'No messages need embedding',
                data: {
                    processedCount: 0,
                    workspaceCount: 0,
                    sqsBatches: 0,
                    failures: 0,
                },
            });
        }

        console.log(`Found ${messages.length} messages needing embedding`);

        const workspaceBatches = groupMessagesByWorkspace(messages);
        const results = await sendToSQS(workspaceBatches);

        console.log('Orchestration complete', {
            totalMessages: messages.length,
            workspaces: workspaceBatches.length,
            sqsBatches: results.batchCount,
            failures: results.failures,
        });

        return successResponse({
            message: 'Embedding orchestrator completed',
            data: {
                processedCount: messages.length,
                workspaceCount: workspaceBatches.length,
                sqsBatches: results.batchCount,
                failures: results.failures,
            },
        });
    } catch (error) {
        console.error('Orchestrator error:', error);
        return errorResponse(error.message, 500);
    }
};

async function fetchMessagesNeedingEmbedding(): Promise<MessageToEmbed[]> {
    const allMessages: MessageToEmbed[] = [];
    let lastCreatedAt: string | null = null;
    let lastId: string | null = null;

    while (allMessages.length < MAX_MESSAGES_PER_RUN) {
        let query = supabase
            .from('messages')
            .select('id, workspace_id, channel_id, conversation_id, parent_message_id, created_at, body, text')
            .eq('needs_embedding', true)
            .is('deleted_at', null)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .limit(BATCH_SIZE);

        if (lastCreatedAt && lastId) {
            query = query.or(`created_at.gt.${lastCreatedAt},and(created_at.eq.${lastCreatedAt},id.gt.${lastId})`);
        }

        const { data, error } = await query;

        if (error) {
            throw new Error(`Failed to fetch messages: ${error.message}`);
        }

        if (!data || data.length === 0) {
            break;
        }

        allMessages.push(...data);

        const lastMessage = data[data.length - 1];
        lastCreatedAt = lastMessage.created_at;
        lastId = lastMessage.id;

        if (data.length < BATCH_SIZE) {
            break;
        }
    }

    return allMessages;
}

function groupMessagesByWorkspace(messages: MessageToEmbed[]): WorkspaceBatch[] {
    const workspaceMap = new Map<string, MessageToEmbed[]>();

    for (const message of messages) {
        const hasTextContent = message.text && /\S/.test(message.text);

        if (hasTextContent) {
            const existing = workspaceMap.get(message.workspace_id) || [];
            existing.push(message);
            workspaceMap.set(message.workspace_id, existing);
        }
    }

    return Array.from(workspaceMap.entries())
        .map(([workspace_id, messages]) => ({ workspace_id, messages }))
        .sort((a, b) => a.messages.length - b.messages.length);
}

async function sendToSQS(workspaceBatches: WorkspaceBatch[]): Promise<{
    batchCount: number;
    failures: number;
}> {
    let batchCount = 0;
    let failures = 0;
    const sqsMessages: SendMessageBatchRequestEntry[] = [];

    for (const batch of workspaceBatches) {
        for (const message of batch.messages) {
            sqsMessages.push({
                Id: message.id,
                MessageBody: JSON.stringify({
                    messageId: message.id,
                    workspaceId: message.workspace_id,
                    channelId: message.channel_id,
                    conversationId: message.conversation_id,
                    parentMessageId: message.parent_message_id,
                    createdAt: message.created_at,
                    body: message.body,
                    text: message.text,
                }),
                MessageAttributes: {
                    workspaceId: {
                        DataType: 'String',
                        StringValue: message.workspace_id,
                    },
                    messageType: {
                        DataType: 'String',
                        StringValue: message.channel_id ? 'channel' : 'conversation',
                    },
                    isThreadMessage: {
                        DataType: 'String',
                        StringValue: message.parent_message_id ? 'true' : 'false',
                    },
                },
            });

            if (sqsMessages.length === SQS_BATCH_SIZE) {
                const result = await sendBatch(sqsMessages);
                batchCount++;
                failures += result.failures;
                sqsMessages.length = 0;
            }
        }
    }

    if (sqsMessages.length > 0) {
        const result = await sendBatch(sqsMessages);
        batchCount++;
        failures += result.failures;
    }

    return { batchCount, failures };
}

async function sendBatch(messages: SendMessageBatchRequestEntry[]): Promise<{
    failures: number;
}> {
    try {
        const command = new SendMessageBatchCommand({
            QueueUrl: SQS_QUEUE_URL,
            Entries: messages,
        });

        const response = await sqs.send(command);

        if (response.Failed && response.Failed.length > 0) {
            console.error('SQS batch send had failures:', response.Failed);
            return { failures: response.Failed.length };
        }

        return { failures: 0 };
    } catch (error) {
        console.error('Failed to send SQS batch:', error);
        return { failures: messages.length };
    }
}
