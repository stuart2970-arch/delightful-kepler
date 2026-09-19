import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_META_VERIFY_TOKEN } from '@/lib/meta';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://tkoasyjvrgaglofpzduq.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * GET: Retrieve current Meta connection settings
 */
export async function GET(request: NextRequest) {
  try {
    const tenantId = request.nextUrl.searchParams.get('tenantId');
    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .maybeSingle();

    const { data: chatbot } = await supabaseAdmin
      .from('chatbots')
      .select('*')
      .eq('tenant_id', tenantId)
      .neq('id', '00000000-0000-0000-0000-000000000000')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const webhookUrl = `${request.nextUrl.origin || 'https://app.styleflo.ai'}/api/webhooks/meta`;
    const verifyToken =
      chatbot?.meta_verify_token ||
      tenant?.meta_verify_token ||
      process.env.META_VERIFY_TOKEN ||
      DEFAULT_META_VERIFY_TOKEN;

    const config = {
      tenantId,
      chatbotId: chatbot?.id,
      webhookUrl,
      verifyToken,
      // WhatsApp
      whatsappEnabled: Boolean(chatbot?.whatsapp_enabled || chatbot?.whatsapp_phone_number_id || tenant?.whatsapp_phone_number_id),
      whatsappPhoneNumber: chatbot?.whatsapp_phone_number || tenant?.twilio_mobile_number || '',
      whatsappPhoneNumberId: chatbot?.whatsapp_phone_number_id || tenant?.whatsapp_phone_number_id || '',
      whatsappWabaId: chatbot?.whatsapp_waba_id || tenant?.whatsapp_waba_id || '',
      // Instagram
      instagramEnabled: Boolean(chatbot?.instagram_enabled || chatbot?.instagram_account_id),
      instagramHandle: chatbot?.instagram_handle || '',
      instagramAccountId: chatbot?.instagram_account_id || tenant?.instagram_account_id || '',
      // Messenger
      messengerEnabled: Boolean(chatbot?.messenger_enabled || chatbot?.messenger_page_id),
      messengerPageId: chatbot?.messenger_page_id || tenant?.messenger_page_id || '',
      // Shared Meta Token (masked for security if present)
      hasAccessToken: Boolean(chatbot?.meta_access_token || tenant?.meta_access_token || process.env.META_ACCESS_TOKEN),
      metaAccessTokenMasked: (chatbot?.meta_access_token || tenant?.meta_access_token)
        ? '••••••••' + (chatbot?.meta_access_token || tenant?.meta_access_token).slice(-6)
        : '',
      metaAppId: chatbot?.meta_app_id || '',
    };

    return NextResponse.json(config);
  } catch (error: any) {
    console.error('[Meta Settings API] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * PATCH: Update Meta connection settings
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      tenantId,
      chatbotId: reqBotId,
      whatsappEnabled,
      whatsappPhoneNumber,
      whatsappPhoneNumberId,
      whatsappWabaId,
      instagramEnabled,
      instagramHandle,
      instagramAccountId,
      messengerEnabled,
      messengerPageId,
      metaAccessToken,
      metaVerifyToken,
      metaAppId,
      metaAppSecret,
    } = body;

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Resolve target chatbot
    let targetBotId = reqBotId;
    if (!targetBotId) {
      const { data: bot } = await supabaseAdmin
        .from('chatbots')
        .select('id')
        .eq('tenant_id', tenantId)
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      targetBotId = bot?.id;
    }

    const botUpdates: Record<string, any> = {};
    const tenantUpdates: Record<string, any> = {};

    if (whatsappEnabled !== undefined) botUpdates.whatsapp_enabled = Boolean(whatsappEnabled);
    if (whatsappPhoneNumber !== undefined) botUpdates.whatsapp_phone_number = whatsappPhoneNumber;
    if (whatsappPhoneNumberId !== undefined) {
      botUpdates.whatsapp_phone_number_id = whatsappPhoneNumberId;
      tenantUpdates.whatsapp_phone_number_id = whatsappPhoneNumberId;
    }
    if (whatsappWabaId !== undefined) {
      botUpdates.whatsapp_waba_id = whatsappWabaId;
      tenantUpdates.whatsapp_waba_id = whatsappWabaId;
    }

    if (instagramEnabled !== undefined) botUpdates.instagram_enabled = Boolean(instagramEnabled);
    if (instagramHandle !== undefined) botUpdates.instagram_handle = instagramHandle;
    if (instagramAccountId !== undefined) {
      botUpdates.instagram_account_id = instagramAccountId;
      tenantUpdates.instagram_account_id = instagramAccountId;
    }

    if (messengerEnabled !== undefined) botUpdates.messenger_enabled = Boolean(messengerEnabled);
    if (messengerPageId !== undefined) {
      botUpdates.messenger_page_id = messengerPageId;
      tenantUpdates.messenger_page_id = messengerPageId;
    }

    if (metaAccessToken) {
      botUpdates.meta_access_token = metaAccessToken;
      tenantUpdates.meta_access_token = metaAccessToken;
    }

    if (metaVerifyToken) {
      botUpdates.meta_verify_token = metaVerifyToken;
      tenantUpdates.meta_verify_token = metaVerifyToken;
    }

    if (metaAppId !== undefined) botUpdates.meta_app_id = metaAppId;
    if (metaAppSecret !== undefined) botUpdates.meta_app_secret = metaAppSecret;

    // Update chatbot
    if (targetBotId && Object.keys(botUpdates).length > 0) {
      const { error: botErr } = await supabaseAdmin
        .from('chatbots')
        .update(botUpdates)
        .eq('id', targetBotId);

      if (botErr) {
        console.error('[Meta Settings API] Chatbot update error:', botErr);
        throw botErr;
      }
    }

    // Update tenant
    if (Object.keys(tenantUpdates).length > 0) {
      const { error: tenantErr } = await supabaseAdmin
        .from('tenants')
        .update(tenantUpdates)
        .eq('id', tenantId);

      if (tenantErr) {
        console.error('[Meta Settings API] Tenant update error:', tenantErr);
      }
    }

    return NextResponse.json({ success: true, message: 'Meta settings updated successfully' });
  } catch (error: any) {
    console.error('[Meta Settings API] PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
