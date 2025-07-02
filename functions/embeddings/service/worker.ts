import { SQSHandler, SQSEvent } from 'aws-lambda';
import OpenAI from 'openai';
import { supabase } from './utils/supabase-client';
import { successResponse } from './utils/response';

// ENV helper: validate and parse environment variables
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
const BATCH_SIZE = getEnv('BATCH_SIZE', (v) => parseInt(v, 10), 100);

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
    createdAt: string; // ISO string
    body: string;
    text: string | null;
}

export const handler: SQSHandler = async (event: SQSEvent) => {
    console.log(`🛎️ Received ${event.Records.length} SQS messages`);

    // 1. Parse bodies
    const messages = event.Records.map((r) => JSON.parse(r.body) as SQSMessageBody);

    // 2. Prepare and truncate content
    // const inputs = messages.map((m) => {
    //     const raw = (m.text || m.body).trim();
    //     let tokens = tokenizer.encode(raw);
    //     if (tokens.length > MODEL_MAX_TOKENS) {
    //         tokens = tokens.slice(0, MODEL_MAX_TOKENS);
    //     }
    //     return tokenizer.decode(tokens);
    // });

    const inputs = messages.map((m) => {
        const raw = (m.text || m.body).trim();
        return truncateToTokenLimit(raw, MODEL_MAX_TOKENS);
    });

    // 3. Batch‐call OpenAI embeddings
    const embedResponse = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: inputs,
        encoding_format: 'float',
        dimensions: 1536,
    });
    const embeddings = embedResponse.data.map((d) => d.embedding);

    // 4. Process all records in parallel
    const results = await Promise.allSettled(messages.map((msg, i) => processOne(msg, embeddings[i])));

    // 5. Tally and rethrow on failure so SQS can retry / DLQ
    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length) {
        const errs = failed.map((r: any) => r.reason.message).join('; ');
        console.error(`❌ ${failed.length} messages failed:`, errs);
        throw new Error(`${failed.length} message(s) failed`);
    }

    console.log(`✅ Successfully processed ${messages.length} messages`);
    return successResponse({ message: 'Successfully processed messages' }, 200);
};

async function processOne(msg: SQSMessageBody, embedding: number[]) {
    const { messageId, workspaceId, channelId, conversationId, createdAt } = msg;

    // --- 1. Semantic context via Postgres RPC (hnsw index) ---
    const { data: ctxRows, error: ctxErr } = await supabase.rpc('find_semantic_neighbors', {
        p_embedding: embedding,
        p_workspace_id: workspaceId,
        p_exclude_message_id: messageId,
        p_time_window_hours: CONTEXT_TIME_WINDOW_HOURS,
        p_similarity_threshold: SIMILARITY_THRESHOLD,
        p_limit: 10,
    });
    if (ctxErr) throw new Error(`Context lookup failed: ${ctxErr.message}`);
    const context_message_ids = (ctxRows as any[]).map((r) => r.message_id);
    const context_scores = (ctxRows as any[]).map((r) => r.similarity);

    // --- 2. Heuristic analysis ---
    const content = (msg.text || msg.body).trim();
    const tokenCount = estimateTokenCount(content);
    const isShortAnswer = tokenCount <= 5;
    const isQuestion =
        /\?/.test(content) ||
        /^(what|when|where|who|why|how|is|are|can|could|would|should|do|does|did)\b/i.test(content);

    // --- 3. Upsert embedding row ---
    const embeddingRecord = {
        message_id: messageId,
        workspace_id: workspaceId,
        channel_id: channelId,
        conversation_id: conversationId,
        embedding,
        embedding_model: EMBEDDING_MODEL,
        embedding_version: '1.0',
        context_message_ids,
        context_scores,
        is_question: isQuestion,
        is_short_answer: isShortAnswer,
        token_count: tokenCount,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };
    const { error: upsertErr } = await supabase
        .from('message_embeddings')
        .upsert(embeddingRecord, { onConflict: 'message_id' });
    if (upsertErr) throw new Error(`Upsert embedding failed: ${upsertErr.message}`);

    // --- 4. Mark original message as processed ---
    const { error: markErr } = await supabase.from('messages').update({ needs_embedding: false }).eq('id', messageId);
    if (markErr) console.warn(`Could not mark ${messageId} processed: ${markErr.message}`);

    // --- 5. Track usage via single RPC upsert ---
    // You must define an RPC in Postgres like `upsert_workspace_embedding_usage`
    // which does an INSERT ... ON CONFLICT (...) DO UPDATE
    const month = new Date().toISOString().slice(0, 7) + '-01';
    const estimatedCost = (tokenCount / 1_000_000) * 0.02; // USD per 1M tokens

    const { error: usageErr } = await supabase.rpc('upsert_workspace_embedding_usage', {
        p_workspace_id: workspaceId,
        p_month: month,
        p_embeddings_increment: 1,
        p_tokens_increment: tokenCount,
        p_cost_increment: estimatedCost,
    });
    if (usageErr) console.error(`Usage update failed: ${usageErr.message}`);
}
