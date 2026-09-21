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
      whatsappEnabled: Boolean(chatbot?.whatsapp_enabled ?? chatbot?.configuration_json?.whatsapp_enabled ?? chatbot?.whatsapp_phone_number_id ?? tenant?.whatsapp_phone_number_id),
      whatsappPhoneNumber: chatbot?.whatsapp_phone_number || chatbot?.configuration_json?.whatsapp_phone_number || tenant?.twilio_mobile_number || '',
      whatsappPhoneNumberId: chatbot?.whatsapp_phone_number_id || chatbot?.configuration_json?.whatsapp_phone_number_id || tenant?.whatsapp_phone_number_id || '',
      whatsappWabaId: chatbot?.whatsapp_waba_id || chatbot?.configuration_json?.whatsapp_waba_id || tenant?.whatsapp_waba_id || '',
      // Instagram
      instagramEnabled: Boolean(chatbot?.instagram_enabled ?? chatbot?.configuration_json?.instagram_enabled ?? chatbot?.instagram_account_id ?? chatbot?.configuration_json?.instagram_account_id),
      instagramHandle: chatbot?.instagram_handle || chatbot?.configuration_json?.instagram_handle || '',
      instagramAccountId: chatbot?.instagram_account_id || chatbot?.configuration_json?.instagram_account_id || tenant?.instagram_account_id || '',
      // Messenger
      messengerEnabled: Boolean(chatbot?.messenger_enabled ?? chatbot?.configuration_json?.messenger_enabled ?? chatbot?.messenger_page_id ?? chatbot?.configuration_json?.messenger_page_id),
      messengerPageId: chatbot?.messenger_page_id || chatbot?.configuration_json?.messenger_page_id || tenant?.messenger_page_id || '',
      // Shared Meta Token (masked for security if present)
      hasAccessToken: Boolean(chatbot?.meta_access_token || chatbot?.configuration_json?.meta_access_token || tenant?.meta_access_token || process.env.META_ACCESS_TOKEN),
      metaAccessTokenMasked: (chatbot?.meta_access_token || chatbot?.configuration_json?.meta_access_token || tenant?.meta_access_token)
        ? '••••••••' + (chatbot?.meta_access_token || chatbot?.configuration_json?.meta_access_token || tenant?.meta_access_token).slice(-6)
        : '',
      metaAppId: chatbot?.meta_app_id || chatbot?.configuration_json?.meta_app_id || '',
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
    let targetBot: any = null;

    if (targetBotId) {
      const { data: bot } = await supabaseAdmin
        .from('chatbots')
        .select('*')
        .eq('id', targetBotId)
        .maybeSingle();
      targetBot = bot;
    }

    if (!targetBot) {
      const { data: bot } = await supabaseAdmin
        .from('chatbots')
        .select('*')
        .eq('tenant_id', tenantId)
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      targetBot = bot;
      targetBotId = bot?.id;
    }

    // Build configuration_json updates
    const existingConfig = (targetBot?.configuration_json || {}) as Record<string, any>;
    const updatedConfig = {
      ...existingConfig,
      ...(whatsappEnabled !== undefined && { whatsapp_enabled: Boolean(whatsappEnabled) }),
      ...(whatsappPhoneNumber !== undefined && { whatsapp_phone_number: whatsappPhoneNumber }),
      ...(whatsappPhoneNumberId !== undefined && { whatsapp_phone_number_id: whatsappPhoneNumberId }),
      ...(whatsappWabaId !== undefined && { whatsapp_waba_id: whatsappWabaId }),
      ...(instagramEnabled !== undefined && { instagram_enabled: Boolean(instagramEnabled) }),
      ...(instagramHandle !== undefined && { instagram_handle: instagramHandle }),
      ...(instagramAccountId !== undefined && { instagram_account_id: instagramAccountId }),
      ...(messengerEnabled !== undefined && { messenger_enabled: Boolean(messengerEnabled) }),
      ...(messengerPageId !== undefined && { messenger_page_id: messengerPageId }),
      ...(metaAccessToken && { meta_access_token: metaAccessToken }),
      ...(metaVerifyToken && { meta_verify_token: metaVerifyToken }),
      ...(metaAppId !== undefined && { meta_app_id: metaAppId }),
      ...(metaAppSecret !== undefined && { meta_app_secret: metaAppSecret }),
    };

    // Prepare top-level column updates
    const botUpdates: Record<string, any> = {
      configuration_json: updatedConfig,
    };
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

    // Update chatbot with fallback if specific columns are missing in PostgREST schema cache
    if (targetBotId) {
      const { error: botErr } = await supabaseAdmin
        .from('chatbots')
        .update(botUpdates)
        .eq('id', targetBotId);

      if (botErr) {
        console.warn('[Meta Settings API] Direct column update failed, retrying with configuration_json fallback:', botErr.message);
        // Fallback: update configuration_json only (guaranteed to succeed)
        const { error: fallbackErr } = await supabaseAdmin
          .from('chatbots')
          .update({ configuration_json: updatedConfig })
          .eq('id', targetBotId);

        if (fallbackErr) {
          console.error('[Meta Settings API] Chatbot fallback update error:', fallbackErr);
          throw fallbackErr;
        }
      }
    }

    // Update tenant defensively
    if (Object.keys(tenantUpdates).length > 0) {
      try {
        const { error: tenantErr } = await supabaseAdmin
          .from('tenants')
          .update(tenantUpdates)
          .eq('id', tenantId);

        if (tenantErr) {
          console.warn('[Meta Settings API] Tenant update warning:', tenantErr.message);
        }
      } catch (tErr: any) {
        console.warn('[Meta Settings API] Tenant update exception:', tErr.message);
      }
    }

    return NextResponse.json({ success: true, message: 'Meta settings updated successfully' });
  } catch (error: any) {
    console.error('[Meta Settings API] PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
