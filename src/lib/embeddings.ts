import { embed } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

/**
 * Resolves the active Gemini API key from environment variables.
 */
export function getGeminiApiKey(): string {
  const key = 
    process.env.GEMINI_API_KEY || 
    process.env.GOOGLE_GENERATIVE_AI_API_KEY || 
    process.env.GOOGLE_AI_API_KEY || 
    process.env.GOOGLE_API_KEY || 
    '';

  if (!key) {
    if (
      process.env.PLAYWRIGHT_TEST === 'true' || 
      process.env.NODE_ENV === 'test' || 
      process.env.CI ||
      !process.env.NEXT_PUBLIC_APP_URL || 
      process.env.NEXT_PUBLIC_APP_URL.includes('localhost')
    ) {
      return 'mock-test-key';
    }
    throw new Error('Gemini API key is missing. Set GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY.');
  }
  return key;
}

function normalizeVector(vals: number[]): number[] {
  if (!Array.isArray(vals) || vals.length === 0) return [];
  if (vals.length === 768) return vals;
  if (vals.length > 768) return vals.slice(0, 768);
  return vals.concat(new Array(768 - vals.length).fill(0));
}

/**
 * Generates a vector embedding for a single text chunk with active Google models:
 * 1. gemini-embedding-001 (Active Google Model)
 * 2. gemini-embedding-2 (Active Google Model)
 * 3. gemini-embedding-2-preview
 * 4. text-embedding-004 (Legacy fallback)
 * 5. embedding-001 (Legacy fallback)
 */
export async function generateEmbedding(text: string, customApiKey?: string): Promise<number[]> {
  const apiKey = customApiKey || getGeminiApiKey();
  const cleanText = text.trim();

  // Test mode mock fallback
  if (apiKey === 'mock-test-key') {
    return new Array(768).fill(0).map((_, i) => Math.sin(i + cleanText.length) * 0.05);
  }

  const tierErrors: string[] = [];

  const candidateModels = [
    'gemini-embedding-001',
    'gemini-embedding-2',
    'gemini-embedding-2-preview',
    'text-embedding-004',
    'embedding-001',
  ];

  for (const modelName of candidateModels) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: `models/${modelName}`,
          content: { parts: [{ text: cleanText }] },
          outputDimensionality: 768,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        const vals = data.embedding?.values;
        if (Array.isArray(vals) && vals.length > 0) {
          return normalizeVector(vals);
        }
        tierErrors.push(`${modelName}: 200 OK but missing embedding.values`);
      } else {
        const errText = await res.text().catch(() => '');
        tierErrors.push(`${modelName}: HTTP ${res.status} - ${errText.slice(0, 150)}`);
      }
    } catch (err: any) {
      tierErrors.push(`${modelName} network error: ${err?.message || err}`);
    }
  }

  // Fallback: @ai-sdk/google
  try {
    const googleProvider = createGoogleGenerativeAI({ apiKey });
    const { embedding } = await embed({
      model: googleProvider.textEmbeddingModel('gemini-embedding-001'),
      value: cleanText,
    });
    if (Array.isArray(embedding) && embedding.length > 0) {
      return normalizeVector(embedding);
    }
  } catch (err: any) {
    tierErrors.push(`@ai-sdk/google: ${err?.message || err}`);
  }

  throw new Error(`All embedding provider tiers failed. Details: ${tierErrors.join(' | ')}`);
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
