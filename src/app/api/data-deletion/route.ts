import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { verifyMetaSignedRequest } from '@/lib/meta-signed-request';
import { eraseMetaUserAcrossSalons } from '@/lib/meta-data-erasure';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment variables are missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function statusUrl(request: NextRequest, confirmationCode: string): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  const origin = (configured || request.nextUrl.origin).replace(/\/$/, '');
  return `${origin}/api/data-deletion?code=${encodeURIComponent(confirmationCode)}`;
}

async function readSignedRequest(request: NextRequest): Promise<string | undefined> {
  const fromQuery = request.nextUrl.searchParams.get('signed_request');
  if (fromQuery) return fromQuery;

  const raw = await request.text();
  if (!raw) return undefined;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      const body = JSON.parse(raw) as { signed_request?: unknown };
      return typeof body.signed_request === 'string' ? body.signed_request : undefined;
    } catch {
      return undefined;
    }
  }

  return new URLSearchParams(raw).get('signed_request') ?? undefined;
}

export async function POST(request: NextRequest) {
  const signedRequest = await readSignedRequest(request);
  if (!signedRequest) {
    return NextResponse.json({ error: 'Malformed signed_request' }, { status: 400 });
  }

  const verified = verifyMetaSignedRequest(signedRequest, process.env.META_APP_SECRET);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: verified.status });
  }

  const confirmationCode = `del_${crypto.randomBytes(18).toString('hex')}`;
  let supabase: SupabaseClient;
  try {
    supabase = getSupabaseAdmin();
  } catch (error) {
    console.error('[Meta Data Deletion] Supabase is not configured');
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const { error: insertError } = await supabase.from('meta_data_deletion_requests').insert({
    confirmation_code: confirmationCode,
    status: 'pending',
  });
  if (insertError) {
    console.error('[Meta Data Deletion] Could not store confirmation', insertError.code);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  try {
    await eraseMetaUserAcrossSalons(supabase, verified.userId);
  } catch (error) {
    console.error(
      '[Meta Data Deletion] Erasure failed',
      error instanceof Error ? error.message : 'error',
    );
    await supabase
      .from('meta_data_deletion_requests')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('confirmation_code', confirmationCode);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const { error: completeError } = await supabase
    .from('meta_data_deletion_requests')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('confirmation_code', confirmationCode);
  if (completeError) {
    console.error('[Meta Data Deletion] Could not mark confirmation completed', completeError.code);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  return NextResponse.json({
    url: statusUrl(request, confirmationCode),
    confirmation_code: confirmationCode,
  });
}

export async function GET(request: NextRequest) {
  const code = (request.nextUrl.searchParams.get('code') || '').trim();
  if (!code) {
    return NextResponse.json({
      status: 'active',
      instructions:
        'To request deletion of your messaging data, please visit https://styleflo.ai/data-deletion or email privacy@styleflo.ai with your phone number or account ID.',
    });
  }

  let supabase: SupabaseClient;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }

  const { data, error } = await supabase
    .from('meta_data_deletion_requests')
    .select('confirmation_code, status')
    .eq('confirmation_code', code)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({
    confirmation_code: data.confirmation_code,
    status: data.status,
  });
}
