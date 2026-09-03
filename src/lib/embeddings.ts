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

/**
 * Generates a vector embedding for a single text chunk with a multi-tier fallback strategy.
 */
export async function generateEmbedding(text: string, customApiKey?: string): Promise<number[]> {
  const apiKey = customApiKey || getGeminiApiKey();
  const cleanText = text.trim();

  // Test mode mock fallback
  if (apiKey === 'mock-test-key') {
    // Generate deterministic 768-dimension normalized vector
    return new Array(768).fill(0).map((_, i) => Math.sin(i + cleanText.length) * 0.05);
  }

  const tierErrors: string[] = [];

  // Tier 1: Google Generative Language REST API v1beta text-embedding-004 (Direct REST with model in body)
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
      if (Array.isArray(vals) && vals.length > 0) return vals;
      tierErrors.push('Tier 1: 200 OK but no values array');
    } else {
      const errText = await res.text().catch(() => '');
      tierErrors.push(`Tier 1 (v1beta with model): HTTP ${res.status} - ${errText.slice(0, 150)}`);
    }
  } catch (err: any) {
    tierErrors.push(`Tier 1 network error: ${err?.message || err}`);
  }

  // Tier 2: Google Generative Language REST API v1beta text-embedding-004 (Direct REST without model in body)
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: cleanText }] },
      }),
    });

    if (res.ok) {
      const data = await res.json();
      const vals = data.embedding?.values;
      if (Array.isArray(vals) && vals.length > 0) return vals;
      tierErrors.push('Tier 2: 200 OK but no values array');
    } else {
      const errText = await res.text().catch(() => '');
      tierErrors.push(`Tier 2 (v1beta no model): HTTP ${res.status} - ${errText.slice(0, 150)}`);
    }
  } catch (err: any) {
    tierErrors.push(`Tier 2 network error: ${err?.message || err}`);
  }

  // Tier 3: Google Generative Language REST API v1 text-embedding-004
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
      if (Array.isArray(vals) && vals.length > 0) return vals;
      tierErrors.push('Tier 3: 200 OK but no values array');
    } else {
      const errText = await res.text().catch(() => '');
      tierErrors.push(`Tier 3 (v1): HTTP ${res.status} - ${errText.slice(0, 150)}`);
    }
  } catch (err: any) {
    tierErrors.push(`Tier 3 network error: ${err?.message || err}`);
  }

  // Tier 4: @ai-sdk/google provider
  try {
    const googleProvider = createGoogleGenerativeAI({ apiKey });
    const { embedding } = await embed({
      model: googleProvider.textEmbeddingModel('text-embedding-004'),
      value: cleanText,
    });
    if (Array.isArray(embedding) && embedding.length > 0) return embedding;
    tierErrors.push('Tier 4: @ai-sdk/google returned empty array');
  } catch (err: any) {
    tierErrors.push(`Tier 4 (@ai-sdk/google): ${err?.message || err}`);
  }

  // Tier 5: Fallback to embedding-001
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
      if (Array.isArray(vals) && vals.length > 0) return vals;
    } else {
      const errText = await res.text().catch(() => '');
      tierErrors.push(`Tier 5 (embedding-001): HTTP ${res.status} - ${errText.slice(0, 150)}`);
    }
  } catch (err: any) {
    tierErrors.push(`Tier 5 network error: ${err?.message || err}`);
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
