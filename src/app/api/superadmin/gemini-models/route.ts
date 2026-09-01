import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  const fallbackPresets = [
    { id: 'gemini-flash-latest', displayName: 'gemini-flash-latest (Auto-updates to Google\'s Latest Flash)', description: 'Google\'s dynamic auto-updating alias', isAlias: true },
    { id: 'gemini-pro-latest', displayName: 'gemini-pro-latest (Auto-updates to Google\'s Latest Pro)', description: 'Google\'s dynamic auto-updating alias', isAlias: true },
    { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', description: 'Fast, high-performance workhorse model', isAlias: false },
    { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', description: 'Deep reasoning and complex task model', isAlias: false },
  ];

  if (!apiKey) {
    return NextResponse.json({ models: fallbackPresets, live: false }, { headers: corsHeaders });
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      next: { revalidate: 3600 }
    });

    if (!res.ok) {
      console.warn('[Gemini Models API] Google AI Studio REST returned non-200:', res.status);
      return NextResponse.json({ models: fallbackPresets, live: false }, { headers: corsHeaders });
    }

    const data = await res.json();
    const rawModels = data.models || [];

    const fetchedModels = rawModels
      .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m: any) => {
        const id = m.name?.replace(/^models\//i, '') || '';
        return {
          id,
          displayName: m.displayName || id,
          description: m.description || '',
          version: m.version || '',
          inputTokenLimit: m.inputTokenLimit || 1048576,
          outputTokenLimit: m.outputTokenLimit || 8192,
          isAlias: false,
        };
      })
      .filter((m: any) => m.id);

    // Merge Google auto-updating aliases at the top
    const combined = [
      { id: 'gemini-flash-latest', displayName: 'gemini-flash-latest (Auto-updates to Google\'s Latest Flash)', description: 'Google\'s dynamic auto-updating alias', isAlias: true },
      { id: 'gemini-pro-latest', displayName: 'gemini-pro-latest (Auto-updates to Google\'s Latest Pro)', description: 'Google\'s dynamic auto-updating alias', isAlias: true },
      ...fetchedModels.filter((m: any) => m.id !== 'gemini-flash-latest' && m.id !== 'gemini-pro-latest')
    ];

    return NextResponse.json({ models: combined, live: true }, { headers: corsHeaders });
  } catch (err) {
    console.error('[Gemini Models API] Error querying Google models:', err);
    return NextResponse.json({ models: fallbackPresets, live: false }, { headers: corsHeaders });
  }
}
