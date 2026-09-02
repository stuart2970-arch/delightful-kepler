import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// Initialize Supabase Admin Client using service role key
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Feature-flag to disable onboarding FloBot
    const disableOnboarding = process.env.DISABLE_ONBOARDING_BOT === 'true';
    if (disableOnboarding && id === 'styleflo-onboarding-flobot') {
      return NextResponse.json({ error: 'Onboarding bot is disabled.' }, { status: 404, headers: corsHeaders });
    }

    if (id === 'styleflo-onboarding-flobot') {
      let floConfig: any = {};
      try {
        const adminSupabase = getSupabaseAdmin();
        const { data: globalBot } = await adminSupabase
          .from('chatbots')
          .select('configuration_json')
          .eq('id', '00000000-0000-0000-0000-000000000000')
          .maybeSingle();
        if (globalBot?.configuration_json?.flobot_config) {
          floConfig = globalBot.configuration_json.flobot_config;
        }
      } catch (e) {
        console.error('Failed to fetch flobot_config from DB:', e);
      }

      return NextResponse.json({
        id: 'styleflo-onboarding-flobot',
        name: floConfig.name || 'FloBot',
        agentName: floConfig.agentName || 'Flo',
        agentRole: floConfig.agentRole || 'StyleFlo AI Receptionist Builder',
        primaryColor: floConfig.primaryColor || '#260475',
        avatarUrl: floConfig.avatarUrl || floConfig.agentAvatarUrl || null,
        agentAvatarUrl: floConfig.avatarUrl || floConfig.agentAvatarUrl || null,
        welcomeMessage: floConfig.welcomeMessage || "Hi, I'm Flo, your AI registration assistant! Tell me, would you prefer to sign up using your Google account or an email address? (The Google sign-in button is at the top of this chat, or pass me your email address to get started!)",
        brandingHtml: '<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by <strong>StyleFlo</strong></span>',
        voiceEnabled: floConfig.voiceEnabled ?? false,
        voiceId: floConfig.voiceId || null,
        voiceProvider: '11labs',
        vapiPublicKey: process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY || process.env.VAPI_PUBLIC_KEY || '3648bdcb-ccac-4acc-aee6-a4f9384743de',
        vapiAssistantId: process.env.VAPI_MASTER_ASSISTANT_ID || '1bb95940-1cb9-4c54-9b16-ba5bc11daae2',
        requireClientName: false
      }, { headers: corsHeaders });
    }

    // Validate UUID format
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid chatbot ID format' }, { status: 400, headers: corsHeaders });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const globalSettingsId = '00000000-0000-0000-0000-000000000000';
    const { data: chatbots, error: chatbotError } = await supabaseAdmin
      .from('chatbots')
      .select('id, tenant_id, name, primary_color, configuration_json, voice_enabled')
      .in('id', [id, globalSettingsId]);

    if (chatbotError || !chatbots || chatbots.length === 0) {
      console.warn(`[Chatbot Config API] Error fetching chatbots: ${id}`);
      return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
    }

    const chatbot = chatbots.find(b => b.id === id);
    if (!chatbot) {
      return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
    }

    let planTier = 'basic';
    
    if (chatbot.tenant_id) {
      const { data: tenantData } = await supabaseAdmin
        .from('tenants')
        .select('plan_tier')
        .eq('id', chatbot.tenant_id)
        .single();
      
      planTier = tenantData?.plan_tier || 'basic';
    }
    
    const eligibleVoiceTiers = ['starter', 'premium', 'ultimate'];
    let voiceProvider = 'none';
    if (eligibleVoiceTiers.includes(planTier)) {
      voiceProvider = '11labs';
    }

    // Check Voice Entitlement
    let hasVoiceMinutes = false;
    if (chatbot.tenant_id && eligibleVoiceTiers.includes(planTier)) {
      hasVoiceMinutes = true;
    }

    const globalBot = chatbots.find(b => b.id === globalSettingsId);
    const globalConfig = (globalBot?.configuration_json || {}) as Record<string, any>;
    const config = (chatbot.configuration_json || {}) as Record<string, any>;

    let resolvedVoiceId = config.voice_id || 'bIHbv24MWmeRgasZH58o';
    
    // If the voice_id is a valid UUID, look it up in the voice_personas table
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedVoiceId)) {
      const { data: persona } = await supabaseAdmin
        .from('voice_personas')
        .select('external_voice_id')
        .eq('id', resolvedVoiceId)
        .single();
        
      if (persona && persona.external_voice_id) {
        resolvedVoiceId = persona.external_voice_id;
      } else {
        const { data: fallbackPersona } = await supabaseAdmin
          .from('voice_personas')
          .select('external_voice_id')
          .limit(1)
          .maybeSingle();
        resolvedVoiceId = fallbackPersona?.external_voice_id || 'c8MZcZcr0JnMAwkwnTIu';
      }
    }

    return NextResponse.json({
      tenantId: chatbot.tenant_id,
      name: chatbot.name,
      primaryColor: chatbot.primary_color,
      agentName: config.agent_name || chatbot.name,
      agentRole: config.agent_role || 'AI Assistant',
      agentAvatarUrl: config.agent_avatar_url || config.agentAvatarUrl || config.avatarUrl || '/avatars/avatar1.png',
      avatarUrl: config.agent_avatar_url || config.agentAvatarUrl || config.avatarUrl || '/avatars/avatar1.png',
      welcomeMessage: config.welcome_message || 'Hello! How can I help you today?',
      brandingHtml: (planTier === 'premium' || planTier === 'ultimate') ? '' : (globalConfig.branding_html || '<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by <strong>StyleFlo</strong></span>'),
      brandingUrl: (planTier === 'premium' || planTier === 'ultimate') ? '' : (globalConfig.branding_url || 'https://styleflo.ai'),
      voiceEnabled: hasVoiceMinutes,
      vapiPublicKey: process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY || process.env.VAPI_PUBLIC_KEY || '',
      vapiAssistantId: process.env.VAPI_MASTER_ASSISTANT_ID || '',
      globalVoiceDisclaimer: globalConfig.global_voice_disclaimer || '',
      voiceProvider: voiceProvider,
      voiceId: resolvedVoiceId,
      backgroundSound: config.background_sound || config.backgroundSound || 'office',
      fileUploadEnabled: Boolean(config.file_upload_enabled ?? (chatbot.id === 'styleflo-onboarding-flobot')),
    }, {
      headers: {
        ...corsHeaders,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      }
    });
  } catch (err: any) {
    console.error('[Chatbot Config API] Unexpected failure:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate UUID format
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid chatbot ID format' }, { status: 400 });
    }

    const body = await request.json();
    const { name, primary_color, configuration_json, voice_enabled } = body;

    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single();

    const dbClient = profile?.is_super_admin ? getSupabaseAdmin() : supabase;

    const { data: chatbot, error: chatbotError } = await dbClient
      .from('chatbots')
      .update({
        name,
        primary_color,
        configuration_json,
        voice_enabled,
      })
      .eq('id', id)
      .select()
      .single();

    if (chatbotError) {
      console.error('[Chatbot Config PATCH API] Error updating chatbot:', chatbotError);
      return NextResponse.json({ error: chatbotError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, chatbot });
  } catch (err: any) {
    console.error('[Chatbot Config PATCH API] Unexpected failure:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate UUID format
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid chatbot ID format' }, { status: 400 });
    }

    const cookieStore = await cookies();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    const supabase = createServerClient(supabaseUrl, anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
    });

    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single();

    const dbClient = profile?.is_super_admin ? getSupabaseAdmin() : supabase;

    const { error: deleteError, count } = await dbClient
      .from('chatbots')
      .delete({ count: 'exact' })
      .eq('id', id);

    if (deleteError) {
      console.error('[Chatbot Config DELETE API] Error deleting chatbot:', deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    if (count === 0) {
      // RLS prevented deletion (or the bot didn't exist), enforce 403 Forbidden
      return NextResponse.json({ error: '403 Forbidden: Unauthorized access to this chatbot' }, { status: 403 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Chatbot Config DELETE API] Unexpected failure:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
