import { SQSHandler, SQSEvent } from 'aws-lambda';
import OpenAI from 'openai';
import { supabase } from '../../common/utils/supabase-client';
import { successResponse } from '../../common/utils/response';

function getEnv<T>(key: string, parser: (v: string) => T, defaultValue?: T): T {
  const raw = process.env[key];
  if (raw == null) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Missing required env var ${key}`);
  }
  try {
    return parser(raw);
  } catch {
    throw new Error(`Invalid value for env var ${key}: ${raw}`);
  }
}

const OPENAI_API_KEY = getEnv('OPENAI_API_KEY', (v) => v);
const EMBEDDING_MODEL = getEnv('EMBEDDING_MODEL', (v) => v, 'text-embedding-3-small');
const MODEL_MAX_TOKENS = getEnv('MODEL_MAX_TOKENS', (v) => parseInt(v, 10), 8191);
const SIMILARITY_THRESHOLD = getEnv('SIMILARITY_THRESHOLD', parseFloat, 0.7);
const CONTEXT_TIME_WINDOW_HOURS = getEnv('CONTEXT_TIME_WINDOW_HOURS', (v) => parseInt(v, 10), 48);

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

function estimateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncateToTokenLimit(text: string, maxTokens: number): string {
  const estimatedTokens = estimateTokenCount(text);
  if (estimatedTokens <= maxTokens) return text;

  const targetLength = Math.floor(maxTokens * 4 * 0.9);
  return text.slice(0, targetLength);
}

interface SQSMessageBody {
  messageId: string;
  workspaceId: string;
  channelId: string | null;
  conversationId: string | null;
  parentMessageId: string | null;
  createdAt: string;
  body: string;
  text: string | null;
}

interface MessageDetail {
  id: string;
  text: string;
  body: string;
  created_at: string;
  parent_message_id: string | null;
}

interface ThreadContext {
  parentMessage?: MessageDetail;
  allThreadMessages: MessageDetail[];
  threadSummary: string;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
  console.log(`🛎️ Received ${event.Records.length} SQS messages`);

  const messages = event.Records.map((r) => JSON.parse(r.body) as SQSMessageBody);

  const threadContextMap = await buildThreadContextMap(messages);

  const enrichedInputs = messages.map((msg) => {
    const content = (msg.text || msg.body).trim();
    const threadContext = threadContextMap.get(msg.parentMessageId || msg.messageId);
    const enrichedContent = enrichContentWithThreadContext(content, threadContext);
    return truncateToTokenLimit(enrichedContent, MODEL_MAX_TOKENS);
  });

  const embedResponse = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: enrichedInputs,
    encoding_format: 'float',
    dimensions: 1536,
  });

  const results = await Promise.allSettled(
    messages.map((msg, i) =>
      processOne(
        msg,
        embedResponse.data[i].embedding,
        threadContextMap.get(msg.parentMessageId || msg.messageId),
      ),
    ),
  );

  const failed = results.filter((r) => r.status === 'rejected');
  if (failed.length) {
    const errs = failed.map((r: any) => r.reason.message).join('; ');
    console.error(`❌ ${failed.length} messages failed:`, errs);
    throw new Error(`${failed.length} message(s) failed`);
  }

  const successfulResults = results.filter(
    (r) => r.status === 'fulfilled',
  ) as PromiseFulfilledResult<any>[];
  const processedMessageIds = successfulResults.map((r) => r.value.messageId);
  const totalTokens = successfulResults.reduce((sum, r) => sum + r.value.tokenCount, 0);
  const workspaceId = messages[0].workspaceId;

  await Promise.allSettled([
    batchUpdateMessagesProcessed(processedMessageIds),
    updateWorkspaceUsage(workspaceId, successfulResults.length, totalTokens),
  ]);

  console.log(`✅ Successfully processed ${messages.length} messages`);
  return successResponse({ message: 'Successfully processed messages' }, 200);
};

async function buildThreadContextMap(
  messages: SQSMessageBody[],
): Promise<Map<string, ThreadContext>> {
  const contextMap = new Map<string, ThreadContext>();
  const currentBatchMessageIds = new Set(messages.map((m) => m.messageId));

  // 1. Identify all unique parent message IDs in the batch.
  const uniqueParentIdsInBatch = [
    ...new Set(messages.filter((m) => m.parentMessageId).map((m) => m.parentMessageId!)),
  ];

  // 2. Separate parent IDs that are in the current batch from those that need to be fetched.
  const parentIdsToFetch = uniqueParentIdsInBatch.filter((id) => !currentBatchMessageIds.has(id));

  let fetchedParentMessages: MessageDetail[] = [];
  if (parentIdsToFetch.length > 0) {
    const { data, error } = await supabase
      .from('messages')
      .select('id, text, body, created_at, parent_message_id')
      .in('id', parentIdsToFetch);
    if (error) {
      console.error('Failed to fetch parent messages:', error.message);
      // Decide how to handle this error - maybe throw, or just continue without this context.
    } else {
      fetchedParentMessages = data || [];
    }
  }

  // 3. Fetch all thread messages for all relevant threads in a single query.
  let allFetchedThreadMessages: MessageDetail[] = [];
  if (uniqueParentIdsInBatch.length > 0) {
    const { data, error } = await supabase
      .from('messages')
      .select('id, text, body, created_at, parent_message_id')
      .in('parent_message_id', uniqueParentIdsInBatch)
      .order('created_at', { ascending: true });
    if (error) {
      console.error('Failed to fetch thread messages:', error.message);
    } else {
      allFetchedThreadMessages = data || [];
    }
  }

  // 4. Map all fetched data for easy lookup.
  const allMessagesMap = new Map<string, MessageDetail>();
  messages.forEach((msg) =>
    allMessagesMap.set(msg.messageId, {
      id: msg.messageId,
      text: msg.text || '',
      body: msg.body,
      created_at: msg.createdAt,
      parent_message_id: msg.parentMessageId,
    }),
  );
  fetchedParentMessages.forEach((msg) => allMessagesMap.set(msg.id, msg));
  allFetchedThreadMessages.forEach((msg) => allMessagesMap.set(msg.id, msg));

  // 5. Build the context map for each thread.
  for (const parentId of uniqueParentIdsInBatch) {
    const parentMessage = allMessagesMap.get(parentId);

    // Filter messages belonging to the current thread from the comprehensive list.
    const allThreadMessages = Array.from(allMessagesMap.values()).filter(
      (m) => m.parent_message_id === parentId,
    );

    // Ensure messages are sorted correctly by time.
    allThreadMessages.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );

    const threadSummary = await createThreadSummary(parentMessage, allThreadMessages);

    contextMap.set(parentId, {
      parentMessage,
      allThreadMessages,
      threadSummary,
    });
  }

  return contextMap;
}

async function createThreadSummary(
  parentMessage: MessageDetail | undefined,
  threadMessages: MessageDetail[],
): Promise<string> {
  const texts = [...(parentMessage ? [parentMessage] : []), ...threadMessages].map((m) =>
    (m.text || m.body).trim(),
  );

  const threadMessagesContent = texts.join('\n\n');
  const systemMessage = {
    role: 'system',
    content: [
      {
        type: 'input_text',
        text: 'Summarize this conversation into one concise paragraph, preserving key points and context. Do not include any additional information or context not present in the conversation. This summary will be used to provide context for a semantic search query.',
      } as OpenAI.Responses.ResponseInputText,
    ] as unknown as OpenAI.Responses.ResponseInputMessageContentList,
  } as OpenAI.Responses.EasyInputMessage;

  const userMessage = {
    role: 'user',
    content: [
      {
        type: 'input_text',
        text: threadMessagesContent,
      } as OpenAI.Responses.ResponseInputText,
    ] as unknown as OpenAI.Responses.ResponseInputMessageContentList,
  } as OpenAI.Responses.EasyInputMessage;

  const { output } = await openai.responses.create({
    model: 'gpt-4.1-mini',
    text: {
      format: {
        type: 'text',
      },
    },
    stream: false,
    temperature: 0.2,
    max_output_tokens: 250,
    input: [systemMessage, userMessage],
  });

  console.log(output?.[0].content?.[0].text?.trim());

  if (output?.[0].content?.[0].text) {
    return output?.[0].content?.[0].text?.trim() ?? '';
  }
  return threadMessagesContent;
}

function enrichContentWithThreadContext(content: string, threadContext?: ThreadContext): string {
  if (!threadContext?.threadSummary) return content;

  const contextPrefix = `[Thread context: ${threadContext.threadSummary}] `;
  const maxContentLength = MODEL_MAX_TOKENS * 4 - contextPrefix.length;
  const truncatedContent = content.slice(0, maxContentLength);

  return contextPrefix + truncatedContent;
}

async function processOne(msg: SQSMessageBody, embedding: number[], threadContext?: ThreadContext) {
  const { messageId, workspaceId, channelId, conversationId, createdAt, parentMessageId } = msg;

  const { data: ctxRows, error: ctxErr } = await supabase.rpc('find_semantic_neighbors', {
    p_embedding: embedding,
    p_workspace_id: workspaceId,
    p_exclude_message_id: messageId,
    p_parent_message_id: parentMessageId,
    p_channel_id: channelId,
    p_conversation_id: conversationId,
    p_time_window_hours: CONTEXT_TIME_WINDOW_HOURS,
    p_similarity_threshold: SIMILARITY_THRESHOLD,
    p_limit: 10,
  });

  if (ctxErr) throw new Error(`Context lookup failed: ${ctxErr.message}`);

  const context_message_ids = (ctxRows as any[]).map((r) => r.message_id);
  const context_scores = (ctxRows as any[]).map((r) => r.similarity);
  const context_types = (ctxRows as any[]).map((r) => r.context_type);

  const content = (msg.text || msg.body).trim();
  const tokenCount = estimateTokenCount(content);
  const isShortAnswer = tokenCount <= 5;

  const embeddingRecord = {
    message_id: messageId,
    workspace_id: workspaceId,
    channel_id: channelId,
    conversation_id: conversationId,
    parent_message_id: parentMessageId,
    embedding,
    embedding_model: EMBEDDING_MODEL,
    embedding_version: '1.0',
    context_message_ids,
    context_scores,
    context_types,
    thread_summary: threadContext?.threadSummary || null,
    is_short_answer: isShortAnswer,
    is_thread_message: !!parentMessageId,
    token_count: tokenCount,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error: upsertErr } = await supabase
    .from('message_embeddings')
    .upsert(embeddingRecord, { onConflict: 'message_id' });
  if (upsertErr) throw new Error(`Upsert embedding failed: ${upsertErr.message}`);

  return { messageId, tokenCount };
}

async function batchUpdateMessagesProcessed(messageIds: string[]) {
  if (messageIds.length === 0) return;

  const { error } = await supabase
    .from('messages')
    .update({ needs_embedding: false })
    .in('id', messageIds);

  if (error) {
    console.error(`Failed to batch update messages: ${error.message}`);
  }
}

async function updateWorkspaceUsage(
  workspaceId: string,
  embeddingCount: number,
  totalTokens: number,
) {
  const month = new Date().toISOString().slice(0, 7) + '-01';
  const estimatedCost = (totalTokens / 1_000_000) * 0.02;

  const { error } = await supabase.rpc('upsert_workspace_embedding_usage', {
    p_workspace_id: workspaceId,
    p_month: month,
    p_embeddings_increment: embeddingCount,
    p_tokens_increment: totalTokens,
    p_cost_increment: estimatedCost,
  });

  if (error) {
    console.error(`Usage update failed: ${error.message}`);
  }
}
