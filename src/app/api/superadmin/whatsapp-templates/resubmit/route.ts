import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withSuperAdmin } from '@/lib/auth/require-superadmin';
import { syncStarterTemplates } from '@/lib/meta';
import { RESUBMIT_STARTER_TEMPLATE_NAMES } from '@/lib/whatsapp-starter-templates';
import { decryptToken } from '@/lib/crypto';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase Service Role configuration');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Resubmit the two rejected en_GB starter templates for one connected WABA.
 *
 * Body: { "wabaId": "1955389302102945", "confirm": true }
 * Omit confirm, or set it to false, for a dry run (Graph GET only).
 * confirm: true edits REJECTED templates via POST /{template-id} and creates
 * a template only when that name and language are absent. PENDING, APPROVED,
 * and PAUSED rows are skipped. The stored business token is decrypted on the
 * server and is never returned.
 *
 * Playwright sets PLAYWRIGHT_TEST, which refuses the call before any Graph
 * request. Do not invoke this route from CI or tests.
 */
export const POST = withSuperAdmin(async (req: NextRequest, _ctx, admin) => {
  if (process.env.PLAYWRIGHT_TEST === 'true') {
    return NextResponse.json(
      { error: 'WhatsApp template resubmit is disabled during tests' },
      { status: 409 },
    );
  }

  let body: { wabaId?: unknown; confirm?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const wabaId = typeof body.wabaId === 'string' ? body.wabaId.trim() : '';
  if (!/^\d{6,32}$/.test(wabaId)) {
    return NextResponse.json(
      { error: 'wabaId must be the numeric WhatsApp Business Account id' },
      { status: 400 },
    );
  }

  const confirm = body.confirm === true;

  let accounts: Array<{
    id: string;
    status: string | null;
    business_token_enc: string | null;
  }> | null = null;
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('whatsapp_accounts')
      .select('id, status, business_token_enc')
      .eq('waba_id', wabaId);
    if (error) {
      return NextResponse.json({ error: 'Failed to load the WhatsApp account' }, { status: 500 });
    }
    accounts = data;
  } catch {
    return NextResponse.json({ error: 'Failed to load the WhatsApp account' }, { status: 500 });
  }

  const withToken = (accounts || []).filter((row) => row.business_token_enc);
  const account = withToken.find((row) => row.status === 'connected') || withToken[0];
  if (!account?.business_token_enc) {
    return NextResponse.json(
      { error: 'No stored WhatsApp token for this WABA. Connect the account in StyleFlo first.' },
      { status: 404 },
    );
  }

  let accessToken = '';
  try {
    accessToken = decryptToken(account.business_token_enc);
  } catch {
    return NextResponse.json({ error: 'Could not decrypt the stored WhatsApp token' }, { status: 500 });
  }
  if (!accessToken) {
    return NextResponse.json({ error: 'Stored WhatsApp token is empty' }, { status: 500 });
  }

  const results = await syncStarterTemplates({
    wabaId,
    accessToken,
    names: RESUBMIT_STARTER_TEMPLATE_NAMES,
    dryRun: !confirm,
  });

  console.log('[WhatsApp templates] resubmit', {
    wabaId,
    performedBy: admin.userId,
    dryRun: !confirm,
    results: results.map((row) => ({
      name: row.name,
      action: row.action,
      status: row.status,
      error: row.error,
    })),
  });

  return NextResponse.json({
    success: results.every((row) => row.action !== 'error'),
    dryRun: !confirm,
    wabaId,
    results,
  });
});
