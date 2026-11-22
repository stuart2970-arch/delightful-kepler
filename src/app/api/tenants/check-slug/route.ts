import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assessName } from '@/lib/moderation/assess-name';
import { assessStoredName } from '@/lib/moderation/assess-stored-name';

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
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const dbClient = createClient(supabaseUrl, anonKey);
    let nameDecision: { action: string; message: string | null } = { action: 'allow', message: null };
    if (serviceRoleKey) {
      const admin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      nameDecision = await assessStoredName(admin, baseSlug, 'slug');
    } else {
      nameDecision = assessName(baseSlug, 'slug');
    }

    if (nameDecision.action === 'reserved' || nameDecision.action === 'block' || nameDecision.action === 'emoji') {
      return NextResponse.json({
        available: false,
        slug: baseSlug,
        url: `${process.env.NEXT_PUBLIC_APP_URL || 'https://styleflo.ai'}/business/${baseSlug}`,
        suggestions: [],
        code: nameDecision.action,
        message: nameDecision.message,
      });
    }

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
        const candidateDecision = assessName(candidate, 'slug');
        const candidateAllowed = candidateDecision.action === 'allow' || candidateDecision.action === 'review';
        if (!existingSlugs.has(candidate) && candidateAllowed && suggestions.length < 3) {
          suggestions.push(candidate);
        }
      }
    }

    return NextResponse.json({
      available: isAvailable,
      slug: baseSlug,
      url: `${baseUrl}/business/${baseSlug}`,
      suggestions,
      code: nameDecision.action === 'allow' ? undefined : nameDecision.action,
      message: nameDecision.action === 'allow' ? undefined : nameDecision.message,
    });
  } catch (err: any) {
    console.error('[check-slug API] Unexpected error:', err);
    if (err?.message === 'Name check is unavailable.') {
      return NextResponse.json({ error: 'Name check is unavailable.' }, { status: 503 });
    }
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
