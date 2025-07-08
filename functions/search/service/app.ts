import { APIGatewayProxyHandler } from 'aws-lambda';
import OpenAI from 'openai';
import { registerTypes, toSql } from 'pgvector/pg';
import { z } from 'zod';
import { successResponse, errorResponse, setCorsHeaders } from '../../common/utils/response';
import dbPool from '../../common/utils/create-db-pool';
import { getUserIdFromToken } from '../../common/helpers/auth';
import { SearchRequest, SearchResponse, SearchResult } from '../types';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const CHAT_MODEL = process.env.CHAT_MODEL || 'gpt-4.1';
const SEARCH_LIMIT = parseInt(process.env.SEARCH_LIMIT || '20');
const SIMILARITY_THRESHOLD = parseFloat(process.env.SIMILARITY_THRESHOLD || '0.6');

// --- Zod schema for our tool’s output ---
const ReferenceSearchSchema = z.object({
    answer: z.string().describe('Markdown answer with inline citations [1],[2],…'),
    references: z.array(
        z.object({
            messageId: z.string().describe('The ID of the referenced message'),
            index: z.number().int().describe('Citation number corresponding to [index]'),
        }),
    ),
});

// --- Define the single tool that the model will call ---
const referenceSearchTool = [
    {
        type: 'function' as const,
        name: 'reference_search',
        description: 'Generate an answer with numbered citations back to message IDs',
        strict: true,
        parameters: {
            type: 'object',
            required: ['answer', 'references'],
            properties: {
                answer: {
                    type: 'string',
                    description: 'Markdown-formatted answer, using [1],[2],… to cite',
                },
                references: {
                    type: 'array',
                    items: {
                        type: 'object',
                        required: ['messageId', 'index'],
                        properties: {
                            messageId: {
                                type: 'string',
                                description: 'ID of the message being cited',
                            },
                            index: {
                                type: 'integer',
                                description: 'Citation number corresponding to [index]',
                            },
                        },
                        additionalProperties: false,
                    },
                },
            },
            additionalProperties: false,
        },
    } as OpenAI.Responses.Tool,
];

export const handler: APIGatewayProxyHandler = async (event, _ctx) => {
    const origin = event.headers.Origin || event.headers.origin;
    const corsHeaders = setCorsHeaders(origin, 'POST');

    if (event.httpMethod === 'OPTIONS') {
        return successResponse({ message: 'OK' }, 200, corsHeaders);
    }

    const start = Date.now();

    try {
        const workspaceId = event.pathParameters?.workspaceId;
        const userId = await getUserIdFromToken(event.headers.Authorization);
        const body = JSON.parse(event.body || '{}') as SearchRequest;
        const { query, limit = SEARCH_LIMIT, includeThreads = true, channelId, conversationId } = body;

        if (!query?.trim()) {
            return errorResponse('Search query is required', 400, corsHeaders);
        }
        if (!workspaceId || !userId) {
            return errorResponse('Workspace ID and User ID are required', 400, corsHeaders);
        }

        // 1) Embed
        const embedding = await openai.embeddings
            .create({
                model: EMBEDDING_MODEL,
                input: query.trim(),
                encoding_format: 'float',
                dimensions: 1536,
            })
            .then((r) => r.data[0].embedding);

        // 2) Vector search
        const results = await searchMessages({
            embedding,
            workspaceId,
            userId,
            limit,
            includeThreads,
            channelId,
            conversationId,
        });

        // 3) Build the system + user messages for the Responses API
        const formattedDocs = results
            .map((r, i) => `${i + 1}. [${r.messageId}] ${r.content} ${r.isThread ? '(Part of thread)' : ''}`)
            .join('\n');

        const systemMessage = {
            role: 'system' as const,
            content: [
                {
                    type: 'input_text' as const,
                    text: `You are an assistant that answers queries about a chat workspace by citing message IDs. 
                    You are to be concise and provide only the answer and citations, without any additional explanation.`,
                },
            ],
        };

        const userMessage = {
            role: 'user' as const,
            content: [
                {
                    type: 'input_text' as const,
                    text: `
                    Question: "${query}"

                    Here are the top ${results.length} retrieved messages:

                    ${formattedDocs}

                    Please provide a concise markdown answer with inline citations [1],[2],… where each [n] refers exactly to the nth message above and return JSON via the function call.
          `.trim(),
                },
            ],
        };

        // 4) Invoke Responses API with our single tool
        const resp = await openai.responses.create({
            model: CHAT_MODEL,
            input: [systemMessage, userMessage],
            tools: referenceSearchTool,
            stream: false,
            temperature: 0.2,
        });

        const call = resp.output[0];
        if (call.type !== 'function_call' || !call.arguments) {
            throw new Error('Model did not invoke reference_search');
        }

        // 5) Parse & validate
        const parsed = ReferenceSearchSchema.parse(JSON.parse(call.arguments));

        console.log('Parsed:', parsed);

        // 6) Return everything
        const executionTime = Date.now() - start;
        const out: SearchResponse = {
            answer: parsed.answer,
            references: parsed.references,
            results,
            totalCount: results.length,
            query: query.trim(),
            executionTime,
        };

        return successResponse(out, 200, corsHeaders);
    } catch (err: any) {
        console.error('Search+Reference error:', err);
        return errorResponse(err.message || 'Internal error', 500, corsHeaders);
    }
};

async function searchMessages(params: {
    embedding: number[];
    workspaceId: string;
    userId: string;
    limit: number;
    includeThreads: boolean;
    channelId?: string;
    conversationId?: string;
}): Promise<SearchResult[]> {
    const { embedding, workspaceId, userId, limit, includeThreads, channelId, conversationId } = params;
    const client = await dbPool.connect();
    await registerTypes(client);

    try {
        const q: any[] = [workspaceId, userId, toSql(embedding), SIMILARITY_THRESHOLD, limit];
        let idx = 6;
        const channelFilter = channelId ? `AND c.id = $${idx++}` : '';
        if (channelId) q.push(channelId);
        const convoFilter = conversationId ? `AND conv.id = $${idx++}` : '';
        if (conversationId) q.push(conversationId);

        const sql = `
      WITH user_workspace_member AS (
        SELECT id AS workspace_member_id
        FROM workspace_members
        WHERE user_id = $2 AND workspace_id = $1 AND is_deactivated = false
      ),
      accessible_channels AS (
        SELECT c.id AS channel_id, c.name AS channel_name
        FROM channels c
        JOIN channel_members cm ON c.id = cm.channel_id
        JOIN workspace_members wm ON cm.workspace_member_id = wm.id
        WHERE c.workspace_id = $1
          AND c.deleted_at IS NULL
          AND cm.left_at IS NULL
          ${channelFilter}
      ),
      accessible_conversations AS (
        SELECT conv.id AS conversation_id
        FROM conversations conv
        JOIN conversation_members convm ON conv.id = convm.conversation_id
        JOIN workspace_members wm ON convm.workspace_member_id = wm.id
        WHERE conv.workspace_id = $1
          AND convm.left_at IS NULL
          AND convm.is_hidden = false
          ${convoFilter}
      ),
      search_results AS (
        SELECT
          me.message_id,
          me.similarity,
          me.channel_id,
          me.conversation_id,
          me.parent_message_id,
          me.thread_summary,
          me.is_thread_message,
          me.context_message_ids,
          m.body,
          m.text,
          m.created_at,
          u.name   AS author_name,
          u.image  AS author_image,
          ac.channel_name,
          CASE
            WHEN me.channel_id IS NOT NULL THEN 'channel'
            WHEN me.conversation_id IS NOT NULL THEN 'conversation'
            ELSE 'thread'
          END AS context_type
        FROM (
          SELECT
            message_id,
            channel_id,
            conversation_id,
            parent_message_id,
            thread_summary,
            is_thread_message,
            context_message_ids,
            1 - (embedding <=> $3) AS similarity
          FROM message_embeddings
          WHERE workspace_id = $1
            AND (embedding <=> $3) < $4
            ${!includeThreads ? 'AND parent_message_id IS NULL' : ''}
          ORDER BY similarity ASC
          LIMIT $5 * 2
        ) me
        JOIN messages m ON me.message_id = m.id
        JOIN workspace_members wm ON m.workspace_member_id = wm.id
        JOIN users u ON wm.user_id = u.id
        LEFT JOIN accessible_channels ac ON me.channel_id = ac.channel_id
        LEFT JOIN accessible_conversations aconv ON me.conversation_id = aconv.conversation_id
        WHERE m.deleted_at IS NULL
          AND (
            (me.channel_id IS NOT NULL AND ac.channel_id IS NOT NULL)
            OR
            (me.conversation_id IS NOT NULL AND aconv.conversation_id IS NOT NULL)
          )
        ORDER BY me.similarity ASC
        LIMIT $5
      )
      SELECT
        message_id,
        COALESCE(text, body) AS content,
        similarity,
        created_at,
        author_name,
        author_image,
        channel_id,
        channel_name,
        conversation_id,
        parent_message_id,
        thread_summary,
        is_thread_message,
        context_type,
        context_message_ids
      FROM search_results
      ORDER BY similarity ASC;
    `;

        const res = await client.query(sql, q);
        return res.rows.map((row) => ({
            messageId: row.message_id,
            content: row.content,
            similarity: parseFloat(row.similarity),
            timestamp: row.created_at,
            authorName: row.author_name,
            authorImage: row.author_image,
            channelId: row.channel_id,
            channelName: row.channel_name,
            conversationId: row.conversation_id,
            isThread: row.is_thread_message,
            parentMessageId: row.parent_message_id,
            threadSummary: row.thread_summary,
            contextType: row.context_type,
            contextMessageIds: row.context_message_ids,
        }));
    } finally {
        client.release();
    }
}
