import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withSuperAdmin } from '@/lib/auth/require-superadmin';
import { moderationSlugKey } from '@/lib/moderation/assess-name';

export const dynamic = 'force-dynamic';

const ACTIONS = new Set(['allow', 'review', 'block', 'reserved']);
const KINDS = new Set(['profanity', 'reserved', 'impersonation', 'brand_token']);

function serviceRoleClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const GET = withSuperAdmin(async () => {
  const admin = serviceRoleClient();
  const { data, error } = await admin
    .from('moderation_terms')
    .select('id, term, kind, severity, action, source, note, created_at')
    .eq('source', 'superadmin')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    return NextResponse.json({ error: 'Name check is unavailable.' }, { status: 503 });
  }
  return NextResponse.json({ terms: data || [] });
});

export const POST = withSuperAdmin(async (req, _ctx, adminUser) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid Payload' }, { status: 400 });
  }

  const rawTerm = typeof body.term === 'string' ? body.term.trim() : '';
  const action = typeof body.action === 'string' ? body.action : '';
  const kind = typeof body.kind === 'string' ? body.kind : 'profanity';
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null;
  if (!rawTerm || !ACTIONS.has(action) || !KINDS.has(kind)) {
    return NextResponse.json({ error: 'Invalid Payload' }, { status: 400 });
  }

  const term = kind === 'reserved'
    ? moderationSlugKey(rawTerm)
    : moderationSlugKey(rawTerm).length > 0 && !rawTerm.includes(' ')
      ? moderationSlugKey(rawTerm)
      : rawTerm.toLowerCase().trim();
  if (!term) {
    return NextResponse.json({ error: 'Invalid Payload' }, { status: 400 });
  }

  const severity = action === 'block' ? 4 : action === 'review' ? 1 : 0;
  const admin = serviceRoleClient();
  const { data, error } = await admin
    .from('moderation_terms')
    .upsert({
      term,
      kind,
      severity,
      action,
      source: 'superadmin',
      note: note ? `${note} (by ${adminUser.userId})` : `set by ${adminUser.userId}`,
    }, { onConflict: 'term,kind' })
    .select('id, term, kind, severity, action, source')
    .single();

  if (error) {
    console.error('[moderation] superadmin upsert failed:', error.message);
    return NextResponse.json({ error: 'Name check is unavailable.' }, { status: 503 });
  }

  return NextResponse.json({ term: data });
});
