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
 * Tier 1: Google Generative Language REST v1beta text-embedding-004 (Direct REST, guaranteed body schema)
 * Tier 2: Google Generative Language REST v1 text-embedding-004
 * Tier 3: @ai-sdk/google (Developer API text-embedding-004)
 * Tier 4: Google Generative Language REST v1beta embedding-001 (Legacy fallback)
 */
export async function generateEmbedding(text: string, customApiKey?: string): Promise<number[]> {
  const apiKey = customApiKey || getGeminiApiKey();
  const cleanText = text.trim();

  // Tier 1: Google Generative Language REST API v1beta text-embedding-004
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text: cleanText }] },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const vals = data.embedding?.values;
      if (Array.isArray(vals) && vals.length > 0) {
        return vals;
      }
    } else {
      const errText = await res.text().catch(() => '');
      console.warn(`[REST Embedding Tier 1] Failed (HTTP ${res.status}): ${errText.slice(0, 300)}`);
    }
  } catch (err: any) {
    console.warn(`[REST Embedding Tier 1] Network error: ${err?.message || err}`);
  }

  // Tier 2: Google Generative Language REST API v1 text-embedding-004
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/text-embedding-004:embedContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text: cleanText }] },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const vals = data.embedding?.values;
      if (Array.isArray(vals) && vals.length > 0) {
        return vals;
      }
    } else {
      const errText = await res.text().catch(() => '');
      console.warn(`[REST Embedding Tier 2] Failed (HTTP ${res.status}): ${errText.slice(0, 300)}`);
    }
  } catch (err: any) {
    console.warn(`[REST Embedding Tier 2] Network error: ${err?.message || err}`);
  }

  // Tier 3: @ai-sdk/google provider
  try {
    const googleProvider = createGoogleGenerativeAI({ apiKey });
    const { embedding } = await embed({
      model: googleProvider.textEmbeddingModel('text-embedding-004'),
      value: cleanText,
    });
    if (Array.isArray(embedding) && embedding.length > 0) {
      return embedding;
    }
  } catch (err: any) {
    console.warn(`[REST Embedding Tier 3 - @ai-sdk/google] Failed: ${err?.message || err}`);
  }

  // Tier 4: Fallback to embedding-001
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/embedding-001:embedContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/embedding-001',
        content: { parts: [{ text: cleanText }] },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const vals = data.embedding?.values;
      if (Array.isArray(vals) && vals.length > 0) {
        return vals;
      }
    } else {
      const errText = await res.text().catch(() => '');
      console.warn(`[REST Embedding Tier 4] Failed (HTTP ${res.status}): ${errText.slice(0, 300)}`);
    }
  } catch (err: any) {
    console.warn(`[REST Embedding Tier 4] Network error: ${err?.message || err}`);
  }

  throw new Error('All embedding provider tiers failed to generate vector embeddings.');
}

/**
 * Batches text embedding requests with concurrency throttling and retry resilience.
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
      batch.map(async (text) => {
        try {
          return await generateEmbedding(text, apiKey);
        } catch (firstErr) {
          console.warn('[batchEmbedTexts] First attempt failed, retrying after 500ms...');
          await new Promise((resolve) => setTimeout(resolve, 500));
          return await generateEmbedding(text, apiKey);
        }
      })
    );
    allEmbeddings.push(...batchResults);

    if (i + batchSize < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }

  return allEmbeddings;
}
