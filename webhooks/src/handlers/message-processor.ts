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
}

export const handler = async (event: SQSEvent): Promise<void> => {
  for (const record of event.Records) {
    try {
      await processMessage(JSON.parse(record.body));
    } catch (error) {
      console.error('Failed to process webhook message:', error);
    }
  }
};

async function processMessage(data: QueuedMessage): Promise<void> {
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
      }),
      data.webhookId,
    ],
  );

  const { id: messageId, created_at } = result.rows[0];

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
        },
        created_at,
      },
    },
  });
}

function convertPayloadToMessage(payload: any): { body: string; blocks: any } {
  const blocks: any[] = [];
  let body = payload.text;

  if (payload.markdown) {
    const lines = payload.markdown.split('\n');
    for (const line of lines) {
      if (line.startsWith('## ')) {
        blocks.push({
          type: 'heading',
          level: 2,
          children: [{ text: line.slice(3) }],
        });
      } else if (line.startsWith('# ')) {
        blocks.push({
          type: 'heading',
          level: 1,
          children: [{ text: line.slice(2) }],
        });
      } else if (line.trim()) {
        blocks.push({
          type: 'paragraph',
          children: [{ text: line }],
        });
      }
    }
    body = payload.markdown.replace(/#+\s*/g, '');
  } else if (payload.text) {
    blocks.push({
      type: 'paragraph',
      children: [{ text: payload.text }],
    });
  }

  if (payload.attachments) {
    for (const attachment of payload.attachments) {
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

      if (attachment.fields) {
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
    body,
    blocks: { type: 'doc', content: blocks },
  };
}
