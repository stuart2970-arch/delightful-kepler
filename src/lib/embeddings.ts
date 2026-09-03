import { embed } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Resolves the active Gemini API key from environment variables.
 */
export function getGeminiApiKey(): string {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';
  if (!key) {
    throw new Error('Gemini API key is missing. Set GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.');
  }
  return key;
}

/**
 * Generates a vector embedding for a single text chunk with a 4-tier fallback strategy:
 * Tier 1: @ai-sdk/google (Developer API text-embedding-004)
 * Tier 2: REST v1beta text-embedding-004
 * Tier 3: REST v1 text-embedding-004
 * Tier 4: REST v1beta embedding-001
 */
export async function generateEmbedding(text: string, customApiKey?: string): Promise<number[]> {
  const apiKey = customApiKey || getGeminiApiKey();

  // Tier 1: @ai-sdk/google provider
  try {
    const googleProvider = createGoogleGenerativeAI({ apiKey });
    const { embedding } = await embed({
      model: googleProvider.textEmbeddingModel('text-embedding-004'),
      value: text,
    });
    if (Array.isArray(embedding) && embedding.length > 0) {
      return embedding;
    }
  } catch (err: any) {
    console.warn(`[@ai-sdk/google] text-embedding-004 failed: ${err?.message || err}. Attempting REST fallback...`);
  }

  // Tier 2 - 4: Google Generative Language REST endpoints
  const fallbackEndpoints = [
    `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1/models/text-embedding-004:embedContent?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${apiKey}`,
  ];

  for (const endpoint of fallbackEndpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { parts: [{ text }] },
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.warn(`[REST Embedding] Endpoint ${endpoint} failed with HTTP ${res.status}: ${errText.slice(0, 200)}`);
        continue;
      }

      const data = await res.json();
      const vals = data.embedding?.values;
      if (Array.isArray(vals) && vals.length > 0) {
        return vals;
      }
    } catch (err: any) {
      console.warn(`[REST Embedding] Network error connecting to ${endpoint}: ${err?.message || err}`);
    }
  }

  throw new Error('All 4 embedding provider tiers failed to generate vector embeddings.');
}

/**
 * Batches text embedding requests with concurrency throttling to prevent rate limiting (429).
 */
export async function batchEmbedTexts(
  texts: string[],
  customApiKey?: string,
  batchSize: number = 5
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = customApiKey || getGeminiApiKey();
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((text) => generateEmbedding(text, apiKey))
    );
    allEmbeddings.push(...batchResults);
  }

  return allEmbeddings;
}
