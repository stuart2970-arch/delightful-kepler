import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { assessStoredName, recordNameDecision } from '@/lib/moderation/assess-stored-name';
import type { NamePolicyContext } from '@/lib/moderation/messages';
import { authRateLimitPerIp, clientIp, consumeAuthRateLimit } from '@/lib/security/auth-rate-limit';

export const dynamic = 'force-dynamic';

const FIELDS: Array<[string, NamePolicyContext]> = [
  ['ownerName', 'owner'],
  ['salonName', 'salon'],
  ['slug', 'slug'],
  ['personaName', 'persona'],
];

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

export async function POST(request: Request) {
  const allowed = await consumeAuthRateLimit(
    `moderation-check:${clientIp(request)}`,
    authRateLimitPerIp(),
    15 * 60,
  );
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return NextResponse.json({ error: 'Invalid Payload' }, { status: 400 });
    }
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid Payload' }, { status: 400 });
  }

  const requested = FIELDS.filter(([key]) => typeof body[key] === 'string');
  if (requested.length === 0) {
    return NextResponse.json({ error: 'Invalid Payload' }, { status: 400 });
  }

  try {
    const admin = serviceRoleClient();
    const results = [];
    for (const [field, context] of requested) {
      const value = String(body[field]);
      const decision = await assessStoredName(admin, value, context);
      if (decision.action !== 'allow') {
        await recordNameDecision(admin, { context, decision, value });
      }
      results.push({
        field,
        action: decision.action,
        message: decision.message,
      });
    }
    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Name check is unavailable.';
    console.error('[moderation] check-name failed:', message);
    return NextResponse.json({ error: 'Name check is unavailable.' }, { status: 503 });
  }
}
