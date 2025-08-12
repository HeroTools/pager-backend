import { SQSEvent } from 'aws-lambda';
import dbPool from '../../../common/utils/create-db-pool';
import { supabase } from '../../../common/utils/supabase-client';

interface QueuedMessage {
  webhookId: string;
  workspaceId: string;
  channelId: string;
  payload: {
    text: string;
    markdown?: string;
    attachments?: Array<{
      color?: string;
      title?: string;
      text?: string;
      fields?: Array<{ title: string; value: string; short?: boolean }>;
    }>;
    username?: string;
    icon_url?: string;
  };
  requestId: string;
  authenticatedUser?: string;
}

export const handler = async (event: SQSEvent): Promise<void> => {
  const results = await Promise.allSettled(
    event.Records.map((record) => processMessage(JSON.parse(record.body))),
  );

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    console.error(`Failed to process ${failures.length}/${event.Records.length} messages`);
    failures.forEach((failure, index) => {
      console.error(`Message ${index} failed:`, failure.reason);
    });
  }
};

async function processMessage(data: QueuedMessage): Promise<void> {
  try {
    if (!isValidMessage(data)) {
      throw new Error(`Invalid message structure for request ${data.requestId}`);
    }

    const { body, blocks } = convertPayloadToMessage(data.payload);

    const result = await dbPool.query(
      `
      INSERT INTO messages (
        workspace_id,
        channel_id,
        body,
        blocks,
        metadata,
        sender_type,
        needs_embedding,
        webhook_id
      ) VALUES ($1, $2, $3, $4, $5, 'system', true, $6)
      RETURNING id, created_at
    `,
      [
        data.workspaceId,
        data.channelId,
        body,
        JSON.stringify(blocks),
        JSON.stringify({
          source: 'webhook',
          webhook_id: data.webhookId,
          request_id: data.requestId,
          webhook_username: data.payload.username,
          webhook_icon_url: data.payload.icon_url,
          authenticated_user: data.authenticatedUser,
          processed_at: new Date().toISOString(),
        }),
        data.webhookId,
      ],
    );

    const { id: messageId, created_at } = result.rows[0];

    await Promise.all([
      broadcastMessage(data, messageId, body, blocks, created_at),
      updateWebhookStats(data.webhookId),
    ]);
  } catch (error) {
    await logProcessingError(data, error);
    throw error;
  }
}

async function broadcastMessage(
  data: QueuedMessage,
  messageId: string,
  body: string,
  blocks: any,
  created_at: string,
): Promise<void> {
  try {
    await supabase.channel(`channel:${data.channelId}`).send({
      type: 'broadcast',
      event: 'new_message',
      payload: {
        channel_id: data.channelId,
        conversation_id: null,
        timestamp: new Date().toISOString(),
        message: {
          id: messageId,
          body,
          blocks,
          workspace_id: data.workspaceId,
          channel_id: data.channelId,
          sender_type: 'system',
          attachments: [],
          reactions: [],
          user: {
            id: 'system',
            name: data.payload.username || 'Webhook',
            image: data.payload.icon_url,
          },
          metadata: {
            source: 'webhook',
            webhook_id: data.webhookId,
            display_name: data.payload.username || 'Webhook',
            request_id: data.requestId,
          },
          created_at,
        },
      },
    });
  } catch (error) {
    console.error(`Failed to broadcast message for request ${data.requestId}:`, error);
  }
}

async function updateWebhookStats(webhookId: string): Promise<void> {
  try {
    await dbPool.query(
      'UPDATE webhooks SET message_count = message_count + 1, last_message_at = now() WHERE id = $1',
      [webhookId],
    );
  } catch (error) {
    console.error(`Failed to update webhook stats for ${webhookId}:`, error);
  }
}

async function logProcessingError(data: QueuedMessage, error: any): Promise<void> {
  try {
    await dbPool.query(
      `INSERT INTO webhook_processing_errors
       (webhook_id, request_id, workspace_id, channel_id, error_message, error_details, failed_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [
        data.webhookId,
        data.requestId,
        data.workspaceId,
        data.channelId,
        error.message,
        JSON.stringify({
          stack: error.stack,
          payload: data.payload,
          error_type: error.constructor.name,
        }),
      ],
    );
  } catch (logError) {
    console.error('Failed to log processing error:', logError);
  }
}

function isValidMessage(data: QueuedMessage): boolean {
  if (!data.webhookId || !data.workspaceId || !data.channelId || !data.requestId) {
    return false;
  }

  if (!data.payload || (!data.payload.text && !data.payload.markdown)) {
    return false;
  }

  return true;
}

function convertPayloadToMessage(payload: QueuedMessage['payload']): { body: string; blocks: any } {
  const blocks: any[] = [];
  let body = payload.text || '';

  if (payload.markdown) {
    body = payload.markdown;
    const lines = payload.markdown.split('\n');

    for (const line of lines) {
      const trimmedLine = line.trim();

      if (!trimmedLine) {
        continue;
      }

      if (trimmedLine.startsWith('### ')) {
        blocks.push({
          type: 'heading',
          level: 3,
          children: [{ text: trimmedLine.slice(4) }],
        });
      } else if (trimmedLine.startsWith('## ')) {
        blocks.push({
          type: 'heading',
          level: 2,
          children: [{ text: trimmedLine.slice(3) }],
        });
      } else if (trimmedLine.startsWith('# ')) {
        blocks.push({
          type: 'heading',
          level: 1,
          children: [{ text: trimmedLine.slice(2) }],
        });
      } else if (trimmedLine.startsWith('- ') || trimmedLine.startsWith('* ')) {
        blocks.push({
          type: 'list_item',
          children: [{ text: trimmedLine.slice(2) }],
        });
      } else if (trimmedLine.startsWith('> ')) {
        blocks.push({
          type: 'blockquote',
          children: [{ text: trimmedLine.slice(2) }],
        });
      } else {
        blocks.push({
          type: 'paragraph',
          children: [{ text: trimmedLine }],
        });
      }
    }
  } else if (payload.text) {
    blocks.push({
      type: 'paragraph',
      children: [{ text: payload.text }],
    });
  }

  if (payload.attachments && payload.attachments.length > 0) {
    for (const attachment of payload.attachments) {
      if (attachment.color) {
        blocks.push({
          type: 'divider',
          attrs: { color: attachment.color },
        });
      }

      if (attachment.title) {
        blocks.push({
          type: 'heading',
          level: 3,
          children: [{ text: attachment.title }],
        });
      }

      if (attachment.text) {
        blocks.push({
          type: 'paragraph',
          children: [{ text: attachment.text }],
        });
      }

      if (attachment.fields && attachment.fields.length > 0) {
        for (const field of attachment.fields) {
          blocks.push({
            type: 'paragraph',
            children: [{ text: `${field.title}: `, bold: true }, { text: field.value }],
          });
        }
      }
    }
  }

  return {
    body: body.trim(),
    blocks: { type: 'doc', content: blocks },
  };
}
