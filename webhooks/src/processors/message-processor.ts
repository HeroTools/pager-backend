import { SQSEvent } from 'aws-lambda';
import dbPool from '../../../common/utils/create-db-pool';
import { supabase } from '../../../common/utils/supabase-client';
import { QueuedMessage, SlackAttachment, SlackMessage } from '../types';

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

  if (!data.payload) {
    return false;
  }

  const hasText = data.payload.text;
  const hasAttachments = data.payload.attachments && data.payload.attachments.length > 0;
  const hasBlocks = data.payload.blocks && data.payload.blocks.length > 0;

  if (!hasText && !hasAttachments && !hasBlocks) {
    return false;
  }

  return true;
}

function convertPayloadToMessage(payload: SlackMessage): { body: string; blocks: any } {
  const blocks: any[] = [];
  let body = '';

  if (payload.text) {
    body += payload.text;
    blocks.push({
      type: 'paragraph',
      children: [{ text: payload.text }],
    });
  }

  if (payload.blocks && payload.blocks.length > 0) {
    for (const block of payload.blocks) {
      const convertedBlock = convertSlackBlockToQuill(block);
      if (convertedBlock) {
        if (Array.isArray(convertedBlock)) {
          blocks.push(...convertedBlock);
        } else {
          blocks.push(convertedBlock);
        }
        body += `\n${extractTextFromBlock(block)}`;
      }
    }
  }

  if (payload.attachments && payload.attachments.length > 0) {
    for (const attachment of payload.attachments) {
      if (attachment.pretext) {
        blocks.push({
          type: 'paragraph',
          children: [{ text: attachment.pretext }],
        });
        body += `\n${attachment.pretext}`;
      }

      if (attachment.author_name) {
        const authorText = attachment.author_link
          ? `[${attachment.author_name}](${attachment.author_link})`
          : attachment.author_name;
        blocks.push({
          type: 'paragraph',
          children: [{ text: `Author: ${authorText}`, italic: true }],
        });
        body += `\nAuthor: ${attachment.author_name}`;
      }

      if (attachment.title) {
        const titleChildren = attachment.title_link
          ? [
              {
                text: attachment.title,
                link: attachment.title_link,
                bold: true,
              },
            ]
          : [{ text: attachment.title, bold: true }];

        blocks.push({
          type: 'heading',
          level: 3,
          children: titleChildren,
        });
        body += `\n${attachment.title}`;
      }

      if (attachment.text) {
        const textContent = parseSlackMarkdown(attachment.text);
        blocks.push({
          type: 'paragraph',
          children: textContent,
        });
        body += `\n${attachment.text}`;
      }

      if (attachment.fields && attachment.fields.length > 0) {
        const fieldsContent = convertFieldsToQuillContent(attachment.fields);
        blocks.push({
          type: 'paragraph',
          children: fieldsContent,
        });

        const fieldsText = attachment.fields
          .map((field) => `${field.title}: ${field.value}`)
          .join(', ');
        body += `\n${fieldsText}`;
      }

      if (attachment.footer) {
        const footerText = attachment.ts
          ? `${attachment.footer} • ${new Date(attachment.ts * 1000).toLocaleString()}`
          : attachment.footer;

        blocks.push({
          type: 'paragraph',
          children: [{ text: footerText, italic: true, color: '#6b7280' }],
        });
        body += `\n${footerText}`;
      }

      if (attachment.color) {
        blocks.push({
          type: 'divider',
          attrs: { color: attachment.color },
        });
      }
    }
  }

  return {
    body: body.trim(),
    blocks: { type: 'doc', content: blocks },
  };
}

function parseSlackMarkdown(text: string): any[] {
  const children: any[] = [];
  let currentText = '';
  let i = 0;

  while (i < text.length) {
    if (text.startsWith('```', i)) {
      if (currentText) {
        children.push({ text: currentText });
        currentText = '';
      }

      const endIndex = text.indexOf('```', i + 3);
      if (endIndex !== -1) {
        const codeText = text.substring(i + 3, endIndex);
        children.push({ text: codeText, code: true });
        i = endIndex + 3;
      } else {
        currentText += text[i];
        i++;
      }
    } else if (text[i] === '*' && text[i + 1] === '*') {
      if (currentText) {
        children.push({ text: currentText });
        currentText = '';
      }

      const endIndex = text.indexOf('**', i + 2);
      if (endIndex !== -1) {
        const boldText = text.substring(i + 2, endIndex);
        children.push({ text: boldText, bold: true });
        i = endIndex + 2;
      } else {
        currentText += text[i];
        i++;
      }
    } else if (text[i] === '*') {
      if (currentText) {
        children.push({ text: currentText });
        currentText = '';
      }

      const endIndex = text.indexOf('*', i + 1);
      if (endIndex !== -1) {
        const italicText = text.substring(i + 1, endIndex);
        children.push({ text: italicText, italic: true });
        i = endIndex + 1;
      } else {
        currentText += text[i];
        i++;
      }
    } else if (text[i] === '`') {
      if (currentText) {
        children.push({ text: currentText });
        currentText = '';
      }

      const endIndex = text.indexOf('`', i + 1);
      if (endIndex !== -1) {
        const codeText = text.substring(i + 1, endIndex);
        children.push({ text: codeText, code: true });
        i = endIndex + 1;
      } else {
        currentText += text[i];
        i++;
      }
    } else if (text[i] === '<' && text.includes('|', i) && text.includes('>', i)) {
      if (currentText) {
        children.push({ text: currentText });
        currentText = '';
      }

      const endIndex = text.indexOf('>', i);
      if (endIndex !== -1) {
        const linkMatch = text.substring(i + 1, endIndex);
        const [url, linkText] = linkMatch.split('|');
        if (url && linkText) {
          children.push({ text: linkText, link: url });
        } else if (url) {
          children.push({ text: url, link: url });
        }
        i = endIndex + 1;
      } else {
        currentText += text[i];
        i++;
      }
    } else {
      currentText += text[i];
      i++;
    }
  }

  if (currentText) {
    children.push({ text: currentText });
  }

  return children.length > 0 ? children : [{ text }];
}

function convertFieldsToQuillContent(fields: SlackAttachment['fields']): any[] {
  const content: any[] = [];

  for (const field of fields || []) {
    content.push({ text: `${field.title}: `, bold: true }, { text: field.value });

    if (field !== fields?.[fields.length - 1]) {
      content.push({ text: ' • ' });
    }
  }

  return content;
}

function convertSlackBlockToQuill(block: any): any | any[] | null {
  switch (block.type) {
    case 'section':
      const sectionBlocks: any[] = [];

      if (block.text) {
        sectionBlocks.push({
          type: 'paragraph',
          children: parseSlackMarkdown(block.text.text || ''),
        });
      }

      if (block.fields && block.fields.length > 0) {
        const fieldsPerRow = 2;
        const rows = Math.ceil(block.fields.length / fieldsPerRow);

        for (let row = 0; row < rows; row++) {
          const rowFields = block.fields.slice(row * fieldsPerRow, (row + 1) * fieldsPerRow);
          const fieldContent: any[] = [];

          rowFields.forEach((field: any, index: number) => {
            if (field.text) {
              fieldContent.push({ text: field.text, bold: true });
              if (index < rowFields.length - 1) {
                fieldContent.push({ text: '    ' });
              }
            }
          });

          if (fieldContent.length > 0) {
            sectionBlocks.push({
              type: 'paragraph',
              children: fieldContent,
            });
          }
        }
      }

      return sectionBlocks.length > 0 ? sectionBlocks : null;

    case 'header':
      return {
        type: 'heading',
        level: 2,
        children: parseSlackMarkdown(block.text?.text || ''),
      };

    case 'context':
      if (block.elements && block.elements.length > 0) {
        const contextContent: any[] = [];

        block.elements.forEach((element: any, index: number) => {
          if (element.type === 'mrkdwn' && element.text) {
            const parsed = parseSlackMarkdown(element.text);
            contextContent.push(...parsed);
          } else if (element.type === 'plain_text' && element.text) {
            contextContent.push({ text: element.text });
          }

          if (index < block.elements.length - 1) {
            contextContent.push({ text: ' ' });
          }
        });

        return {
          type: 'paragraph',
          children: contextContent.length > 0 ? contextContent : [{ text: '', italic: true }],
          attrs: { class: 'context' },
        };
      }
      return null;

    case 'divider':
      return {
        type: 'divider',
      };

    case 'rich_text':
      if (block.elements && block.elements.length > 0) {
        return block.elements
          .map((element: any) => convertRichTextElement(element))
          .filter(Boolean);
      }
      return null;

    default:
      console.warn(`Unhandled block type: ${block.type}`);
      return null;
  }
}

function convertRichTextElement(element: any): any | null {
  switch (element.type) {
    case 'rich_text_section':
      if (element.elements && element.elements.length > 0) {
        const children = element.elements
          .map((el: any) => convertRichTextInline(el))
          .filter(Boolean);
        return {
          type: 'paragraph',
          children: children.length > 0 ? children : [{ text: '' }],
        };
      }
      return null;

    case 'rich_text_list':
      if (element.elements && element.elements.length > 0) {
        return {
          type: element.style === 'ordered' ? 'orderedList' : 'bulletList',
          children: element.elements.map((item: any) => ({
            type: 'listItem',
            children: item.elements
              ? item.elements.map((el: any) => convertRichTextInline(el)).filter(Boolean)
              : [{ text: '' }],
          })),
        };
      }
      return null;

    default:
      return null;
  }
}

function convertRichTextInline(element: any): any | null {
  switch (element.type) {
    case 'text':
      const textNode: any = { text: element.text || '' };
      if (element.style?.bold) textNode.bold = true;
      if (element.style?.italic) textNode.italic = true;
      if (element.style?.strike) textNode.strike = true;
      if (element.style?.code) textNode.code = true;
      return textNode;

    case 'link':
      return {
        text: element.text || element.url,
        link: element.url,
      };

    case 'user':
      return {
        text: `@${element.user_id}`,
        mention: true,
      };

    case 'channel':
      return {
        text: `#${element.channel_id}`,
        mention: true,
      };

    default:
      return { text: element.text || '' };
  }
}

function extractTextFromBlock(block: any): string {
  switch (block.type) {
    case 'section':
      let text = '';
      if (block.text?.text) {
        text += block.text.text;
      }
      if (block.fields && block.fields.length > 0) {
        const fieldsText = block.fields
          .map((field: any) => field.text || '')
          .filter(Boolean)
          .join(' ');
        text += (text ? ' ' : '') + fieldsText;
      }
      return text;

    case 'header':
      return block.text?.text || '';

    case 'context':
      if (block.elements && block.elements.length > 0) {
        return block.elements
          .map((element: any) => element.text || '')
          .filter(Boolean)
          .join(' ');
      }
      return '';

    case 'divider':
      return '---';

    case 'rich_text':
      if (block.elements && block.elements.length > 0) {
        return block.elements
          .map((element: any) => extractTextFromRichTextElement(element))
          .filter(Boolean)
          .join(' ');
      }
      return '';

    default:
      return '';
  }
}

function extractTextFromRichTextElement(element: any): string {
  switch (element.type) {
    case 'rich_text_section':
      if (element.elements && element.elements.length > 0) {
        return element.elements
          .map((el: any) => el.text || '')
          .filter(Boolean)
          .join('');
      }
      return '';

    case 'rich_text_list':
      if (element.elements && element.elements.length > 0) {
        return element.elements
          .map((item: any) => {
            if (item.elements && item.elements.length > 0) {
              return item.elements
                .map((el: any) => el.text || '')
                .filter(Boolean)
                .join('');
            }
            return '';
          })
          .filter(Boolean)
          .join(' ');
      }
      return '';

    default:
      return element.text || '';
  }
}
