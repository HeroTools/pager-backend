import { openai } from '../../../common/utils/create-embedding';

export interface Message {
  messageId: string;
  content: string;
  timestamp: string;
  updatedAt: string;
  editedAt: string;
  messageType: string;
  parentMessageId: string;
  threadId: string;
  senderType: string;
  author: {
    id: string;
    name: string;
    image: string;
  };
  channelId: string;
  channelName: string;
  conversationId: string;
  contextType: string;
  isThreadReply: boolean;
}

export interface ProcessedMessage {
  contextType: 'channel' | 'conversation' | 'unknown';
  channelId?: string;
  conversationId?: string;
  channelName: string;
  messageId?: string;
  content: string;
  timestamp: string;
  author: { id: string; name: string };
  type: 'message' | 'summary';
}

export class SummarizingMessageProcessor {
  private localOpenAI = openai;
  private readonly RECENT_WINDOW_HOURS = 24;
  private readonly CHUNK_SIZE = 20;
  private readonly MAX_MESSAGES = 50;
  private readonly MIN_CONTENT_LENGTH = 15;
  private readonly MAX_CONTENT_LENGTH = 1000;
  private readonly boilerplatePhrases = [
    'joined the channel',
    'left the channel',
    'uploaded a file',
    'started a call',
    'set the topic to',
    'changed their status',
  ];

  /**
   * Splits raw messages into:
   *  - recent messages (< RECENT_WINDOW_HOURS)
   *  - older messages
   * Summarizes older messages in CHUNK_SIZE batches,
   * then returns CHUNK summaries + up to MAX_MESSAGES/2 raw recent messages,
   * sorted by timestamp, capped at MAX_MESSAGES total.
   */
  public async process(messages: Message[]): Promise<ProcessedMessage[]> {
    // 1) Filter out too-short/long or boilerplate
    const filtered = messages.filter((m) => {
      const c = m.content.trim();
      if (c.length < this.MIN_CONTENT_LENGTH || c.length > this.MAX_CONTENT_LENGTH) {
        return false;
      }
      const lc = c.toLowerCase();
      return !this.boilerplatePhrases.some((phrase) => lc.includes(phrase));
    });

    // 2) Split recent vs. older
    const now = Date.now();
    const recent: Message[] = [];
    const older: Message[] = [];
    for (const m of filtered) {
      const ageHrs = (now - new Date(m.timestamp).getTime()) / (1000 * 60 * 60);
      if (ageHrs < this.RECENT_WINDOW_HOURS) recent.push(m);
      else older.push(m);
    }

    // 3) Take the longest recent messages (they tend to be more substantive)
    const topRecent = recent
      .sort((a, b) => b.content.length - a.content.length)
      .slice(0, Math.floor(this.MAX_MESSAGES / 2))
      .map<ProcessedMessage>((m) => ({
        contextType: m.contextType as 'channel' | 'conversation',
        channelId: m.channelId,
        conversationId: m.conversationId,
        channelName: m.channelName,
        messageId: m.messageId,
        content: m.content,
        timestamp: m.timestamp,
        author: m.author,
        type: 'message',
      }));

    // 4) Summarize older messages in CHUNK_SIZE batches
    const summaries: ProcessedMessage[] = [];
    for (let i = 0; i < older.length; i += this.CHUNK_SIZE) {
      const chunk = older.slice(i, i + this.CHUNK_SIZE);
      const summaryText = await this.summarizeChunk(chunk);
      // Timestamp of the summary = first message in the chunk
      summaries.push({
        contextType: chunk[0].channelId ? 'channel' : 'conversation',
        channelId: chunk[0].channelId,
        conversationId: chunk[0].conversationId,
        channelName: chunk[0].channelName,
        content: summaryText,
        timestamp: chunk[0].timestamp,
        author: { id: '', name: 'Summary' },
        type: 'summary',
      });
    }

    // 5) Merge and sort by timestamp, then cap at MAX_MESSAGES
    const merged = [...summaries, ...topRecent].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return merged.slice(-this.MAX_MESSAGES);
  }

  private async summarizeChunk(chunk: Message[]): Promise<string> {
    const bulletList = chunk.map((m) => `- ${m.author.name}: ${m.content}`).join('\n');
    const prompt = `Summarize these messages into concise bullet points:\n${bulletList}`;
    const resp = await this.localOpenAI.responses.create({
      model: 'gpt-4.1-mini',
      text: {
        format: {
          type: 'text',
        },
      },
      stream: false,
      temperature: 0.2,
      max_output_tokens: 250,
      input: [{ role: 'system', content: prompt }],
    });
    return resp.output?.[0].content?.[0].text?.trim() ?? '';
  }
}

const summarizingProcessor = new SummarizingMessageProcessor();
export { summarizingProcessor };
