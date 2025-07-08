export interface Database {
    public: {
        Tables: {
            messages: {
                Row: {
                    id: string;
                    body: string;
                    text: string | null;
                    workspace_id: string;
                    workspace_member_id: string;
                    channel_id: string | null;
                    conversation_id: string | null;
                    parent_message_id: string | null;
                    thread_id: string | null;
                    needs_embedding: boolean;
                    created_at: string;
                    updated_at: string | null;
                    edited_at: string | null;
                    deleted_at: string | null;
                    message_type: 'direct' | 'channel' | 'thread';
                    blocks: any | null;
                    metadata: any | null;
                };
                Insert: Omit<Database['public']['Tables']['messages']['Row'], 'id' | 'created_at'>;
                Update: Partial<Database['public']['Tables']['messages']['Insert']>;
            };
            message_embeddings: {
                Row: {
                    id: string;
                    message_id: string;
                    workspace_id: string;
                    channel_id: string | null;
                    conversation_id: string | null;
                    embedding: number[];
                    embedding_model: string;
                    embedding_version: string | null;
                    context_message_ids: string[];
                    context_scores: number[];
                    is_question: boolean;
                    is_short_answer: boolean;
                    token_count: number | null;
                    created_at: string;
                    updated_at: string;
                };
                Insert: Omit<
                    Database['public']['Tables']['message_embeddings']['Row'],
                    'id' | 'created_at' | 'updated_at'
                >;
                Update: Partial<Database['public']['Tables']['message_embeddings']['Insert']>;
            };
            workspace_embedding_usage: {
                Row: {
                    id: string;
                    workspace_id: string;
                    month: string;
                    total_embeddings_created: number;
                    total_tokens_used: number;
                    estimated_cost_usd: number;
                    last_updated_at: string;
                    created_at: string;
                };
                Insert: Omit<Database['public']['Tables']['workspace_embedding_usage']['Row'], 'id' | 'created_at'>;
                Update: Partial<Database['public']['Tables']['workspace_embedding_usage']['Insert']>;
            };
        };
        Views: {};
        Functions: {
            find_semantic_neighbors: {
                Args: {
                    p_embedding: number[];
                    p_workspace_id: string;
                    p_exclude_message_id: string;
                    p_time_window_hours?: number;
                    p_similarity_threshold?: number;
                    p_limit?: number;
                };
                Returns: Array<{
                    message_id: string;
                    similarity: number;
                    created_at: string;
                }>;
            };
            expand_search_results_with_context: {
                Args: {
                    p_message_ids: string[];
                    p_max_hops?: number;
                };
                Returns: Array<{
                    message_id: string;
                    hop_distance: number;
                    linked_from: string | null;
                }>;
            };
        };
        Enums: {};
    };
}

export interface SearchRequest {
    query: string;
    workspaceId: string;
    userId: string;
    limit?: number;
    includeThreads?: boolean;
    channelId?: string;
    conversationId?: string;
}

export interface SearchResult {
    messageId: string;
    content: string;
    similarity: number;
    timestamp: string;
    authorName: string;
    authorImage?: string;
    channelId?: string;
    channelName?: string;
    conversationId?: string;
    isThread: boolean;
    parentMessageId?: string;
    threadSummary?: string;
    contextType: 'channel' | 'conversation' | 'thread';
    contextMessageIds: string[];
}

export interface SearchResponse {
    answer: string;
    references: { messageId: string; index: number }[];
    results: SearchResult[];
    totalCount: number;
    query: string;
    executionTime: number;
}
