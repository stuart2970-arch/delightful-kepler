import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';
import {
  exchangeCodeForToken,
  validateWabaAndPhone,
  checkWabaPaymentMethod,
  subscribeAppToWaba,
  registerPhoneNumber,
  submitStarterTemplates,
} from '@/lib/meta';
import { encryptToken, encryptPin, maskPhoneNumber } from '@/lib/crypto';

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
 * GET: Retrieves the current WhatsApp connection status, display number, and card missing alert for the tenant.
 */
export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Database credentials missing' }, { status: 500 });
    }

    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    });

    const supabaseAdmin = getSupabaseAdmin();
    let user = (await supabase.auth.getUser()).data?.user;
    if (!user) {
      const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        const { data: userData } = await supabaseAdmin.auth.getUser(token);
        if (userData?.user) {
          user = userData.user;
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id, role, is_super_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || !profile.tenant_id) {
      return NextResponse.json({ error: 'No active salon tenant found' }, { status: 403 });
    }

    const tenantId = profile.tenant_id;

    const { data: account } = await supabaseAdmin
      .from('whatsapp_accounts')
      .select('id, waba_id, phone_number_id, display_phone, display_name, mode, status, card_missing, payment_status, quality_rating, messaging_limit, updated_at')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    return NextResponse.json({
      success: true,
      connected: account?.status === 'connected',
      account: account || null,
    });
  } catch (err: any) {
    console.error('[WhatsApp Onboard GET] Error:', err);
    return NextResponse.json({ error: err.message || 'Error fetching WhatsApp status' }, { status: 500 });
  }
}

/**
 * POST: Completes WhatsApp Embedded Signup (v4) Onboarding
 * 1. Exchanges auth code for permanent access token
 * 2. Validates WABA & phone number
 * 3. Checks salon payment method status (salons pay Meta directly)
 * 4. Subscribes app to WABA
 * 5. Registers phone number with generated 6-digit PIN
 * 6. Submits starter en_GB templates
 * 7. Stores encrypted tokens and sets status to 'connected'
 */
export async function POST(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Database credentials missing' }, { status: 500 });
    }

    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    });

    let user = (await supabase.auth.getUser()).data?.user;
    if (!user) {
      const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        const { data: userData } = await supabase.auth.getUser(token);
        if (userData?.user) {
          user = userData.user;
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id, role, is_super_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || !profile.tenant_id) {
      return NextResponse.json({ error: 'No active salon tenant found' }, { status: 403 });
    }

    const tenantId = profile.tenant_id;
    const body = await req.json();
    const { code, waba_id, phone_number_id, twilio_number_sid } = body;

    if (!code || !waba_id || !phone_number_id) {
      return NextResponse.json(
        { error: 'Missing required onboarding parameters (code, waba_id, or phone_number_id)' },
        { status: 400 }
      );
    }

    console.log(`[WhatsApp Onboard] Initiating onboarding for tenant ${tenantId}, phoneId ${phone_number_id}`);

    // 1. Exchange short-lived authorization code for access token
    const tokenResult = await exchangeCodeForToken({ code });
    if (!tokenResult.success || !tokenResult.accessToken) {
      return NextResponse.json(
        { error: tokenResult.error || 'Failed to exchange authorization code with Meta' },
        { status: 400 }
      );
    }
    const businessToken = tokenResult.accessToken;

    // 2. Validate WABA and phone number
    const validation = await validateWabaAndPhone({
      wabaId: waba_id,
      phoneNumberId: phone_number_id,
      accessToken: businessToken,
    });
    if (!validation.isValid) {
      return NextResponse.json(
        { error: validation.error || 'Failed to validate phone number against WABA' },
        { status: 400 }
      );
    }

    // 3. Check salon payment card (salons pay Meta directly)
    const paymentCheck = await checkWabaPaymentMethod({
      wabaId: waba_id,
      accessToken: businessToken,
    });

    // 4. Subscribe app to WABA webhooks
    const subscribeResult = await subscribeAppToWaba({
      wabaId: waba_id,
      accessToken: businessToken,
    });
    if (!subscribeResult.success) {
      console.warn('[WhatsApp Onboard] App subscription returned warning:', subscribeResult.error);
    }

    // 5. Generate secure 6-digit registration PIN and register phone number
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    const registerResult = await registerPhoneNumber({
      phoneNumberId: phone_number_id,
      pin,
      accessToken: businessToken,
    });
    if (!registerResult.success) {
      console.warn('[WhatsApp Onboard] Phone registration warning:', registerResult.error);
    }

    // 6. Submit starter en_GB templates (async / non-blocking)
    submitStarterTemplates({
      wabaId: waba_id,
      accessToken: businessToken,
    }).catch(err => console.warn('[WhatsApp Onboard] Template submission error:', err));

    // 7. Encrypt sensitive credentials
    const businessTokenEnc = encryptToken(businessToken, 1);
    const pinEnc = encryptPin(pin);

    // 8. Persist WhatsApp account for tenant
    const accountRecord = {
      tenant_id: tenantId,
      waba_id,
      phone_number_id,
      display_phone: validation.displayPhone || null,
      display_name: validation.displayName || null,
      mode: 'cloud',
      status: 'connected',
      business_token_enc: businessTokenEnc,
      token_key_version: 1,
      pin_enc: pinEnc,
      twilio_number_sid: twilio_number_sid || null,
      quality_rating: validation.qualityRating || 'UNKNOWN',
      payment_status: paymentCheck.paymentStatus,
      card_missing: paymentCheck.cardMissing,
      last_card_check_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data: savedAccount, error: dbErr } = await supabaseAdmin
      .from('whatsapp_accounts')
      .upsert(accountRecord, { onConflict: 'phone_number_id' })
      .select('id, waba_id, phone_number_id, display_phone, display_name, mode, status, card_missing, payment_status, quality_rating, messaging_limit, updated_at')
      .single();

    if (dbErr) {
      console.error('[WhatsApp Onboard] DB Save Error:', dbErr);
      return NextResponse.json({ error: 'Failed to persist WhatsApp account in database' }, { status: 500 });
    }

    console.log(`[WhatsApp Onboard] Successfully connected WhatsApp for tenant ${tenantId} (${maskPhoneNumber(validation.displayPhone)})`);

    return NextResponse.json({
      success: true,
      message: 'WhatsApp Business account onboarded and connected successfully.',
      account: savedAccount,
    });
  } catch (err: any) {
    console.error('[WhatsApp Onboard POST] Exception:', err);
    return NextResponse.json({ error: err.message || 'Onboarding error' }, { status: 500 });
  }
}

/**
 * DELETE: Disconnects WhatsApp account and unregisters webhook subscription
 */
export async function DELETE(req: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return NextResponse.json({ error: 'Database credentials missing' }, { status: 500 });
    }

    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {},
      },
    });

    let user = (await supabase.auth.getUser()).data?.user;
    if (!user) {
      const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '').trim();
        const { data: userData } = await supabase.auth.getUser(token);
        if (userData?.user) {
          user = userData.user;
        }
      }
    }

    if (!user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('tenant_id, role, is_super_admin')
      .eq('id', user.id)
      .maybeSingle();

    if (!profile || !profile.tenant_id) {
      return NextResponse.json({ error: 'No active salon tenant found' }, { status: 403 });
    }

    const tenantId = profile.tenant_id;

    const { data: account } = await supabaseAdmin
      .from('whatsapp_accounts')
      .select('id, waba_id, business_token_enc')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (account) {
      // Unsubscribe app from WABA if token is decryptable
      if (account.waba_id && account.business_token_enc) {
        try {
          const { decryptToken } = await import('@/lib/crypto');
          const token = decryptToken(account.business_token_enc);
          const { META_GRAPH_BASE_URL } = await import('@/lib/meta');
          await fetch(`${META_GRAPH_BASE_URL}/${account.waba_id}/subscribed_apps`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch {
          // Ignore unsubscribe network error on teardown
        }
      }

      await supabaseAdmin
        .from('whatsapp_accounts')
        .update({
          status: 'disconnected',
          business_token_enc: null,
          pin_enc: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', account.id);
    }

    return NextResponse.json({
      success: true,
      message: 'WhatsApp account disconnected successfully.',
    });
  } catch (err: any) {
    console.error('[WhatsApp Onboard DELETE] Error:', err);
    return NextResponse.json({ error: err.message || 'Error disconnecting account' }, { status: 500 });
  }
}
