import {
  SQSClient,
  SendMessageBatchCommand,
  SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import { ScheduledHandler } from 'aws-lambda';
import dbPool from '../../../common/utils/create-db-pool';
import { errorResponse, successResponse } from '../../../common/utils/response';

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

    const { validMessages, invalidMessageIds } = filterAndValidateMessages(messages);

    if (invalidMessageIds.length > 0) {
      await markMessagesAsNotNeedingEmbedding(invalidMessageIds);
      console.log(`Marked ${invalidMessageIds.length} invalid messages as not needing embedding`);
    }

    if (validMessages.length === 0) {
      console.log('No valid messages to embed after filtering');
      return successResponse({
        message: 'No valid messages to embed',
        data: {
          processedCount: messages.length,
          invalidCount: invalidMessageIds.length,
          validCount: 0,
        },
      });
    }

    const workspaceBatches = groupMessagesByWorkspace(validMessages);
    const { batchCount, failures } = await sendToSQS(workspaceBatches);

    console.log('Orchestration complete', {
      total: messages.length,
      valid: validMessages.length,
      invalid: invalidMessageIds.length,
      batches: batchCount,
      failures,
    });

    return successResponse({
      message: 'Embedding orchestrator completed',
      data: {
        processedCount: messages.length,
        validCount: validMessages.length,
        invalidCount: invalidMessageIds.length,
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

function filterAndValidateMessages(messages: MessageToEmbed[]): {
  validMessages: MessageToEmbed[];
  invalidMessageIds: string[];
} {
  const validMessages: MessageToEmbed[] = [];
  const invalidMessageIds: string[] = [];

  for (const msg of messages) {
    const content = (msg.text || msg.body || '').trim();

    if (!content || !/\S/.test(content)) {
      console.log(`Message ${msg.id} has no content, marking as not needing embedding`);
      invalidMessageIds.push(msg.id);
      continue;
    }

    if (content.length > 100000) {
      console.log(
        `Message ${msg.id} is too long (${content.length} chars), marking as not needing embedding`,
      );
      invalidMessageIds.push(msg.id);
      continue;
    }

    validMessages.push(msg);
  }

  return { validMessages, invalidMessageIds };
}

async function markMessagesAsNotNeedingEmbedding(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;

  const client = await dbPool.connect();
  try {
    const query = `
      UPDATE messages
      SET needs_embedding = false, claimed_at = null
      WHERE id = ANY($1)
    `;
    await client.query(query, [messageIds]);
  } finally {
    client.release();
  }
}

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
    const arr = map.get(msg.workspace_id) || [];
    arr.push(msg);
    map.set(msg.workspace_id, arr);
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
          messageType: {
            DataType: 'String',
            StringValue: msg.channel_id ? 'channel' : 'conversation',
          },
          isThreadMessage: {
            DataType: 'String',
            StringValue: msg.parent_message_id ? 'true' : 'false',
          },
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
