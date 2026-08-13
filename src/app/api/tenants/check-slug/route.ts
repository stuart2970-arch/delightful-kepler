import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawName = searchParams.get('name') || searchParams.get('slug') || '';

    if (!rawName.trim()) {
      return NextResponse.json({
        available: true,
        slug: '',
        url: '',
        suggestions: [],
      });
    }

    const baseSlug = slugify(rawName);
    if (!baseSlug) {
      return NextResponse.json({
        available: true,
        slug: '',
        url: '',
        suggestions: [],
      });
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const dbClient = createClient(supabaseUrl, anonKey);

    // Fetch matching existing slugs
    const { data: existingTenants, error } = await dbClient
      .from('tenants')
      .select('slug')
      .ilike('slug', `${baseSlug}%`);

    if (error) {
      console.error('[check-slug API] Supabase error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const existingSlugs = new Set((existingTenants || []).map(t => t.slug?.toLowerCase()));
    const isAvailable = !existingSlugs.has(baseSlug);

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://styleflo.ai';
    const suggestions: string[] = [];

    if (!isAvailable) {
      const candidates = [
        `${baseSlug}-1`,
        `${baseSlug}-uk`,
        `${baseSlug}-salon`,
        `${baseSlug}-store`,
        `${baseSlug}-official`,
        `${baseSlug}-2`,
      ];

      for (const candidate of candidates) {
        if (!existingSlugs.has(candidate) && suggestions.length < 3) {
          suggestions.push(candidate);
        }
      }
    }

    return NextResponse.json({
      available: isAvailable,
      slug: baseSlug,
      url: `${baseUrl}/${baseSlug}`,
      suggestions,
    });
  } catch (err: any) {
    console.error('[check-slug API] Unexpected error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
