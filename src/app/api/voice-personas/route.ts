import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

const DEFAULT_PERSONAS = [
  {
    id: 'c8MZcZcr0JnMAwkwnTIu',
    external_voice_id: 'c8MZcZcr0JnMAwkwnTIu',
    name: 'Jay - Manchester Accent',
    role: 'Friendly & Conversational',
    gender: 'Male',
    nationality: 'GB',
    provider: '11labs',
    preview_url: '/audio/c8MZcZcr0JnMAwkwnTIu_jay_manchester.mp3',
    previewUrl: '/audio/c8MZcZcr0JnMAwkwnTIu_jay_manchester.mp3'
  },
  {
    id: 'dqTe8OSrj3PERbkXF8Kx',
    external_voice_id: 'dqTe8OSrj3PERbkXF8Kx',
    name: 'Liverpool Accent - Female',
    role: 'Warm & Customer Service',
    gender: 'Female',
    nationality: 'GB',
    provider: '11labs',
    preview_url: '/audio/dqTe8OSrj3PERbkXF8Kx_lpool_woman.mp3',
    previewUrl: '/audio/dqTe8OSrj3PERbkXF8Kx_lpool_woman.mp3'
  }
];

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: personas, error } = await supabaseAdmin
      .from('voice_personas')
      .select('*')
      .order('created_at', { ascending: true });

    if (error || !personas || personas.length === 0) {
      return NextResponse.json(DEFAULT_PERSONAS, { headers: corsHeaders });
    }

    // Attach local audio URLs if matching voice IDs exist
    const enriched = personas.map((p: any) => {
      let previewUrl = p.preview_url || p.previewUrl || '';
      if (p.external_voice_id === 'c8MZcZcr0JnMAwkwnTIu' || p.id === 'c8MZcZcr0JnMAwkwnTIu') {
        previewUrl = '/audio/c8MZcZcr0JnMAwkwnTIu_jay_manchester.mp3';
      } else if (p.external_voice_id === 'dqTe8OSrj3PERbkXF8Kx' || p.id === 'dqTe8OSrj3PERbkXF8Kx') {
        previewUrl = '/audio/dqTe8OSrj3PERbkXF8Kx_lpool_woman.mp3';
      }
      return {
        ...p,
        preview_url: previewUrl,
        previewUrl: previewUrl
      };
    });

    return NextResponse.json(enriched, { headers: corsHeaders });
  } catch (err: any) {
    console.error('Failed to fetch voice personas:', err);
    return NextResponse.json(DEFAULT_PERSONAS, { headers: corsHeaders });
  }
}

export async function POST(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const body = await request.json();

    const { data: persona, error } = await supabaseAdmin
      .from('voice_personas')
      .insert([body])
      .select()
      .single();

    if (error) {
      console.error('Failed to create voice persona:', error);
      return NextResponse.json({ error: error.message }, { status: 400, headers: corsHeaders });
    }

    return NextResponse.json(persona, { headers: corsHeaders });
  } catch (err: any) {
    console.error('Failed to create voice persona:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}
