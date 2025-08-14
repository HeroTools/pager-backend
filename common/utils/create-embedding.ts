import OpenAI from 'openai';

// Initialize OpenAI client (ensure OPENAI_API_KEY is set in your environment)
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  maxRetries: 2,
});

/**
 * Generates a semantic embedding for the given text input.
 *
 * @param input - The text to embed.
 * @returns A promise resolving to an array of floats representing the embedding vector.
 */
export async function createEmbedding(input: string): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input,
    });
    // The OpenAI client returns an array of embedding data; take the first one
    const embedding = response.data[0].embedding;
    return embedding;
  } catch (error) {
    console.error('Error creating embedding:', error);
    throw new Error('Failed to create embedding');
  }
}
