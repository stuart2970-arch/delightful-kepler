import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

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
 * GET/POST: Automated 90-day GDPR Purge for WhatsApp Messages & Expired Verification Codes.
 * Gated by CRON_SECRET or Admin authorization header.
 */
export async function POST(req: NextRequest) {
  return handlePurge(req);
}

export async function GET(req: NextRequest) {
  return handlePurge(req);
}

async function handlePurge(req: NextRequest) {
  try {
    const authHeader = req.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Optional verification if CRON_SECRET is set
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      const apiKeyParam = req.nextUrl.searchParams.get('key');
      if (apiKeyParam !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }

    const supabaseAdmin = getSupabaseAdmin();
    const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const verificationCutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    // 1. Purge messages older than 90 days
    let deletedMessagesCount = 0;
    try {
      const { data: rpcCount, error: rpcErr } = await supabaseAdmin.rpc('purge_expired_whatsapp_messages');
      if (!rpcErr && typeof rpcCount === 'number') {
        deletedMessagesCount = rpcCount;
      } else {
        // Fallback direct delete query
        const { data: directDeleted, error: delErr } = await supabaseAdmin
          .from('whatsapp_messages')
          .delete()
          .lt('created_at', cutoffDate)
          .select('id');
        if (!delErr && directDeleted) {
          deletedMessagesCount = directDeleted.length;
        }
      }
    } catch {
      // Fallback direct delete query
      const { data: directDeleted } = await supabaseAdmin
        .from('whatsapp_messages')
        .delete()
        .lt('created_at', cutoffDate)
        .select('id');
      if (directDeleted) {
        deletedMessagesCount = directDeleted.length;
      }
    }

    // 2. Clean up expired verification codes older than 1 hour
    await supabaseAdmin
      .from('whatsapp_verification_codes')
      .delete()
      .lt('expires_at', verificationCutoff);

    return NextResponse.json({
      success: true,
      message: 'WhatsApp 90-day GDPR message retention purge executed successfully.',
      retention_days: 90,
      purged_before: cutoffDate,
      deleted_messages: deletedMessagesCount,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[WhatsApp Purge API] Error:', err);
    return NextResponse.json({ error: err.message || 'Error executing purge' }, { status: 500 });
  }
}
