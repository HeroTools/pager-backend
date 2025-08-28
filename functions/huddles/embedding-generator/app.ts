import { EventBridgeEvent, ScheduledEvent } from 'aws-lambda';
import dbPool from '../../../common/utils/create-db-pool';
import { createEmbedding } from '../../../common/utils/create-embedding';

interface HuddleTranscriptChunk {
  id: string;
  huddle_id: string;
  content: string;
  created_at: string;
}

interface EmbeddingGenerationEvent {
  huddle_id: string;
  force_regenerate?: boolean;
}

export const handler = async (
  event: ScheduledEvent | EventBridgeEvent<string, EmbeddingGenerationEvent>,
): Promise<void> => {
  let client;

  try {
    console.log('Starting huddle embedding generation:', JSON.stringify(event, null, 2));

    client = await dbPool.connect();

    try {
      let huddleIds: string[] = [];

      // Check if this is a specific huddle embedding request or scheduled batch processing
      if ('detail' in event && event.detail?.huddle_id) {
        huddleIds = [event.detail.huddle_id];
        console.log(`Processing embeddings for specific huddle: ${event.detail.huddle_id}`);
      } else {
        // Scheduled run - find huddles that need embedding processing
        const findHuddlesQuery = `
          SELECT DISTINCT h.id
          FROM huddles h
          INNER JOIN huddle_transcripts ht ON h.id = ht.huddle_id
          LEFT JOIN huddle_embeddings he ON ht.id = he.transcript_id
          WHERE h.status IN ('ended', 'active')
            AND he.id IS NULL  -- Only process transcripts without embeddings
            AND ht.created_at >= NOW() - INTERVAL '7 days'  -- Only recent huddles
          ORDER BY h.id
          LIMIT 10  -- Process up to 10 huddles per run to avoid timeouts
        `;

        const huddlesResult = await client.query(findHuddlesQuery);
        huddleIds = huddlesResult.rows.map((row) => row.id);

        if (huddleIds.length === 0) {
          console.log('No huddles requiring embedding generation found');
          return;
        }

        console.log(`Found ${huddleIds.length} huddles requiring embedding generation`);
      }

      // Process each huddle
      for (const huddleId of huddleIds) {
        await processHuddleEmbeddings(client, huddleId);
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error generating huddle embeddings:', error);
    throw error;
  } finally {
    if (client) {
      client.release();
    }
  }
};

async function processHuddleEmbeddings(client: any, huddleId: string): Promise<void> {
  console.log(`Processing embeddings for huddle: ${huddleId}`);

  // Get all transcript segments for this huddle that don't have embeddings yet
  const getTranscriptsQuery = `
    SELECT
      ht.id,
      ht.huddle_id,
      ht.content,
      ht.created_at
    FROM huddle_transcripts ht
    LEFT JOIN huddle_embeddings he ON ht.id = he.transcript_id
    WHERE ht.huddle_id = $1
      AND he.id IS NULL  -- No embedding exists yet
      AND LENGTH(TRIM(ht.content)) > 10  -- Skip very short segments
    ORDER BY ht.created_at ASC
  `;

  const transcriptsResult = await client.query(getTranscriptsQuery, [huddleId]);
  const transcripts = transcriptsResult.rows as HuddleTranscriptChunk[];

  if (transcripts.length === 0) {
    console.log(`No transcripts requiring embeddings for huddle ${huddleId}`);
    return;
  }

  console.log(`Processing ${transcripts.length} transcript segments for huddle ${huddleId}`);

  // Group transcripts into chunks for more meaningful embeddings
  const chunks = createTranscriptChunks(transcripts);

  for (const chunk of chunks) {
    try {
      await processTranscriptChunk(client, chunk);
    } catch (chunkError) {
      console.error(`Error processing chunk for huddle ${huddleId}:`, chunkError);
      // Continue processing other chunks even if one fails
    }
  }

  console.log(`Completed embedding generation for huddle ${huddleId}`);
}

function createTranscriptChunks(transcripts: HuddleTranscriptChunk[]): HuddleTranscriptChunk[][] {
  const chunks: HuddleTranscriptChunk[][] = [];
  const maxChunkSize = 1500; // Characters per chunk for meaningful context

  let currentChunk: HuddleTranscriptChunk[] = [];
  let currentChunkSize = 0;

  for (const transcript of transcripts) {
    const transcriptSize = transcript.content.length;

    // If adding this transcript would exceed our chunk size and we have content, start a new chunk
    if (currentChunkSize + transcriptSize > maxChunkSize && currentChunk.length > 0) {
      chunks.push([...currentChunk]);
      currentChunk = [];
      currentChunkSize = 0;
    }

    currentChunk.push(transcript);
    currentChunkSize += transcriptSize;
  }

  // Add the last chunk if it has content
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

async function processTranscriptChunk(client: any, chunk: HuddleTranscriptChunk[]): Promise<void> {
  // Combine the chunk content for embedding
  const combinedContent = chunk.map((t) => t.content).join(' ');

  try {
    // Generate embedding using the utility function
    const embedding = await createEmbedding(combinedContent);

    // Insert embeddings for each transcript in the chunk
    // We'll use the same embedding for all transcripts in the chunk since they provide context to each other
    for (const transcript of chunk) {
      const insertEmbeddingQuery = `
        INSERT INTO huddle_embeddings (
          huddle_id,
          transcript_id,
          embedding,
          embedding_model,
          token_count
        ) VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (transcript_id)
        DO UPDATE SET
          embedding = EXCLUDED.embedding,
          embedding_model = EXCLUDED.embedding_model,
          token_count = EXCLUDED.token_count,
          created_at = NOW()
      `;

      await client.query(insertEmbeddingQuery, [
        transcript.huddle_id,
        transcript.id,
        `[${embedding.join(',')}]`, // PostgreSQL vector format
        'text-embedding-3-small',
        Math.floor(embedding.length / chunk.length), // Distribute token count across chunk items
      ]);
    }

    console.log(`Generated embeddings for chunk of ${chunk.length} transcript segments`);
  } catch (embeddingError) {
    console.error('Error generating embedding for transcript chunk:', embeddingError);
    throw embeddingError;
  }
}
