import { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import OpenAI from 'openai';
import { supabase } from './utils/supabase-client';
import { errorResponse, successResponse } from './utils/response';
import { getUserIdFromToken } from './helpers/auth';
import { AuthError } from './utils/errors';

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
});

const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';

interface SearchRequest {
    query: string;
    workspaceId: string;
    channelId?: string;
    conversationId?: string;
    limit?: number;
    minScore?: number;
    includeContext?: boolean;
}

interface SearchResult {
    messageId: string;
    workspaceId: string;
    channelId: string | null;
    conversationId: string | null;
    score: number;
    message: {
        id: string;
        body: string;
        text: string | null;
        createdAt: string;
        author: {
            id: string;
            name: string;
            image: string | null;
        };
    };
    context?: SearchResult[];
}

export const handler: APIGatewayProxyHandler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
    try {
        const userId = await getUserIdFromToken(event.headers.Authorization || event.headers.authorization);
        if (!userId) {
            throw new AuthError('Unauthorized', 401);
        }

        if (!event.body) {
            return errorResponse('Request body is required', 400);
        }

        const searchRequest: SearchRequest = JSON.parse(event.body);

        if (!searchRequest.query?.trim()) {
            return errorResponse('Query parameter is required', 400);
        }

        if (!searchRequest.workspaceId) {
            return errorResponse('Workspace ID is required', 400);
        }

        await verifyWorkspaceAccess(userId, searchRequest.workspaceId);

        const results = await performSemanticSearch(searchRequest);

        return successResponse({
            message: 'Search completed successfully',
            data: {
                query: searchRequest.query,
                results: results,
                count: results.length,
            },
        });
    } catch (error) {
        console.error('Search error:', error);
        return errorResponse(error.message, error.statusCode || 500);
    }
};

async function verifyWorkspaceAccess(userId: string, workspaceId: string): Promise<void> {
    const { data: membership, error } = await supabase
        .from('workspace_members')
        .select('id')
        .eq('user_id', userId)
        .eq('workspace_id', workspaceId)
        .eq('is_deactivated', false)
        .single();

    if (error || !membership) {
        throw errorResponse('Access denied to workspace', 403);
    }
}

async function performSemanticSearch(request: SearchRequest): Promise<SearchResult[]> {
    const {
        query,
        workspaceId,
        channelId,
        conversationId,
        limit = 20,
        minScore = 0.7,
        includeContext = false,
    } = request;

    const queryEmbedding = await createEmbedding(query);

    const searchResults = await searchEmbeddings(
        queryEmbedding,
        workspaceId,
        channelId,
        conversationId,
        limit,
        minScore,
    );

    const enrichedResults = await enrichResultsWithMessageData(searchResults);

    if (includeContext) {
        await addContextToResults(enrichedResults);
    }

    return enrichedResults;
}

async function createEmbedding(text: string): Promise<number[]> {
    try {
        const response = await openai.embeddings.create({
            model: EMBEDDING_MODEL,
            input: text,
            encoding_format: 'float',
        });

        return response.data[0].embedding;
    } catch (error) {
        console.error('Failed to create query embedding:', error);
        throw new Error(`Embedding creation failed: ${error.message}`);
    }
}

async function searchEmbeddings(
    queryEmbedding: number[],
    workspaceId: string,
    channelId?: string,
    conversationId?: string,
    limit = 20,
    minScore = 0.7,
): Promise<Array<{ messageId: string; channelId: string | null; conversationId: string | null; score: number }>> {
    let whereConditions = `workspace_id = '${workspaceId}'`;

    if (channelId) {
        whereConditions += ` AND channel_id = '${channelId}'`;
    } else if (conversationId) {
        whereConditions += ` AND conversation_id = '${conversationId}'`;
    }

    const embeddingArray = `[${queryEmbedding.join(',')}]`;

    const { data, error } = await supabase.rpc('search_message_embeddings', {
        query_embedding: embeddingArray,
        workspace_filter: workspaceId,
        channel_filter: channelId,
        conversation_filter: conversationId,
        similarity_threshold: minScore,
        match_limit: limit,
    });

    if (error) {
        console.error('Embedding search failed:', error);
        throw new Error(`Search failed: ${error.message}`);
    }

    return data || [];
}

async function enrichResultsWithMessageData(
    searchResults: Array<{ messageId: string; channelId: string | null; conversationId: string | null; score: number }>,
): Promise<SearchResult[]> {
    if (searchResults.length === 0) {
        return [];
    }

    const messageIds = searchResults.map((r) => r.messageId);

    const { data: messages, error } = await supabase
        .from('messages')
        .select(
            `
            id,
            body,
            text,
            created_at,
            workspace_id,
            channel_id,
            conversation_id,
            workspace_member:workspace_member_id (
                user:users (
                    id,
                    name,
                    image
                )
            )
        `,
        )
        .in('id', messageIds)
        .is('deleted_at', null);

    if (error) {
        throw new Error(`Failed to fetch message data: ${error.message}`);
    }

    const messageMap = new Map(messages?.map((m) => [m.id, m]) || []);

    return searchResults
        .map((result) => {
            const message = messageMap.get(result.messageId);
            if (!message) return null;

            return {
                messageId: result.messageId,
                workspaceId: message.workspace_id,
                channelId: result.channelId,
                conversationId: result.conversationId,
                score: result.score,
                message: {
                    id: message.id,
                    body: message.body,
                    text: message.text,
                    createdAt: message.created_at,
                    author: {
                        id: message.workspace_member?.user?.id || '',
                        name: message.workspace_member?.user?.name || 'Unknown User',
                        image: message.workspace_member?.user?.image || null,
                    },
                },
            };
        })
        .filter(Boolean) as SearchResult[];
}

async function addContextToResults(results: SearchResult[]): Promise<void> {
    for (const result of results) {
        const { data: embedding, error } = await supabase
            .from('message_embeddings')
            .select('context_message_ids, context_scores')
            .eq('message_id', result.messageId)
            .single();

        if (error || !embedding || !embedding.context_message_ids?.length) {
            result.context = [];
            continue;
        }

        const contextResults: Array<{ messageId: string; score: number }> = embedding.context_message_ids.map(
            (id: string, index: number) => ({
                messageId: id,
                score: embedding.context_scores[index] || 0,
            }),
        );

        const enrichedContext = await enrichResultsWithMessageData(
            contextResults.map((ctx) => ({
                messageId: ctx.messageId,
                channelId: result.channelId,
                conversationId: result.conversationId,
                score: ctx.score,
            })),
        );

        result.context = enrichedContext;
    }
}
