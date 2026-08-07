import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

// Vapi sends a POST request when a call comes in
export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log('[Vapi Assistant Webhook] Full incoming body:', JSON.stringify(body, null, 2));

    // Vapi webhook payload structure
    const message = body.message;
    if (!message || message.type !== 'assistant-request') {
      return NextResponse.json({ success: true, ignored: true });
    }

    const call = message.call;
    if (!call) {
      console.warn('[Vapi Assistant Webhook] Missing call object in payload.');
      return NextResponse.json({});
    }

    // Extract phone number from all possible Vapi payload properties
    const rawNumber = 
      message.phoneNumber?.number ||
      (typeof call?.phoneNumber === 'string' ? call.phoneNumber : call?.phoneNumber?.number) ||
      call?.to?.phoneNumber ||
      call?.phone_number ||
      call?.customer?.number ||
      '';

    const twilioNumber = rawNumber.trim();
    console.log(`[Vapi Assistant Webhook] Incoming call payload received. Target Number: "${twilioNumber}"`);

    // Initialize Supabase Admin Client to bypass RLS
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://tkoasyjvrgaglofpzduq.supabase.co';
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRrb2FzeWp2cmdhZ2xvZnB6ZHVxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTU5NTcwNSwiZXhwIjoyMDk3MTcxNzA1fQ.VyWIQX2CFUUsAyDakbIEX805sz35TxHnjcAxBPWxliw';
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase admin environment variables are missing');
    }
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Look up the tenant by their Twilio shadow number
    let tenant: any = null;
    let chatbot: any = null;

    if (twilioNumber) {
      // Try exact match first
      const { data: exactMatch } = await supabaseAdmin
        .from('tenants')
        .select('id, plan_tier')
        .eq('twilio_shadow_number', twilioNumber)
        .maybeSingle();

      tenant = exactMatch;

      // If no exact match, try matching without leading '+' or with clean digits
      if (!tenant) {
        const cleanDigits = twilioNumber.replace(/\D/g, '');
        if (cleanDigits) {
          const { data: fuzzyMatch } = await supabaseAdmin
            .from('tenants')
            .select('id, plan_tier')
            .ilike('twilio_shadow_number', `%${cleanDigits}%`)
            .maybeSingle();

          tenant = fuzzyMatch;
        }
      }
    }

    // 2. Fetch the chatbot config if tenant was found
    if (tenant) {
      const { data: matchedChatbot } = await supabaseAdmin
        .from('chatbots')
        .select('id, tenant_id, configuration_json')
        .eq('tenant_id', tenant.id)
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .maybeSingle();

      chatbot = matchedChatbot;
    }

    // Fallback: If no tenant/chatbot matched the phone number, fetch the first active client chatbot
    if (!chatbot) {
      console.warn(`[Vapi Assistant Webhook] Target number "${twilioNumber}" did not match an active tenant chatbot. Falling back to active client chatbot.`);
      const { data: fallbackChatbot } = await supabaseAdmin
        .from('chatbots')
        .select('id, tenant_id, configuration_json')
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .not('tenant_id', 'is', null)
        .limit(1)
        .single();

      if (fallbackChatbot) {
        chatbot = fallbackChatbot;
        tenant = { id: fallbackChatbot.tenant_id, plan_tier: 'ultimate' };
      }
    }

    if (!chatbot || !tenant) {
      console.error('[Vapi Assistant Webhook] No active chatbots exist in database.');
      return NextResponse.json({});
    }

    const config = (chatbot.configuration_json || {}) as Record<string, any>;
    
    // Resolve Voice ID (ElevenLabs vs PlayHT etc)
    let resolvedVoiceId = config.voice_id || 'bIHbv24MWmeRgasZH58o';
    let voiceProvider = 'elevenlabs';

    // If it's a UUID, look it up in voice_personas
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedVoiceId)) {
      const { data: persona } = await supabaseAdmin
        .from('voice_personas')
        .select('external_voice_id, provider')
        .eq('id', resolvedVoiceId)
        .single();
        
      if (persona && persona.external_voice_id) {
        resolvedVoiceId = persona.external_voice_id;
        if (persona.provider === 'playht') {
          voiceProvider = 'playht';
        }
      }
    }

    // Custom LLM model provider pointing to Gemini 1.5 Flash endpoint
    const appUrl = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.styleflo.ai').replace(/\/$/, '');
    const modelOverrides: any = {
      provider: 'custom-llm',
      url: `${appUrl}/api/voice/${chatbot.id}`,
      model: 'gemini-3.5-flash',
      messages: [
        {
          role: 'system',
          content: config.system_prompt || 'You are a helpful assistant.'
        }
      ]
    };

    // Include Knowledge Base config if specified in the DB (usually passed as an array of tool/retrieval IDs)
    if (config.knowledge_base_ids) {
      modelOverrides.knowledgeBase = {
         provider: 'vapi',
         knowledgeBaseIds: config.knowledge_base_ids
      };
    }

    // 3. Build the full assistant object dynamically
    const overrides: any = {
      name: config.agent_name || 'Dynamic Assistant',
      firstMessage: config.welcome_message || 'Hello, how can I help you today?',
      transcriber: {
        provider: 'deepgram',
        model: 'nova-2',
        language: 'en-US'
      },
      model: modelOverrides,
      voice: {
        provider: '11labs',
        voiceId: resolvedVoiceId,
        model: 'eleven_turbo_v2_5',
        enableSsmlParsing: true
      },
      // variableValues is NOT allowed in the root assistant schema, use metadata!
      metadata: {
        tenant_id: tenant.id,
        chatbot_id: chatbot.id
      }
    };

    console.log(`[Vapi Assistant Webhook] Returning custom assistant for ${twilioNumber} (Tenant: ${tenant.id}, Voice: ${resolvedVoiceId})`);

    // Vapi documentation is inconsistent. Send both root properties and the messageResponse wrapper.
    return NextResponse.json({
      assistant: overrides,
      assistantOverrides: overrides,
      messageResponse: {
        assistant: overrides,
        assistantOverrides: overrides
      }
    });

  } catch (err: any) {
    console.error('[Vapi Assistant Webhook] Error processing webhook:', err);
    return NextResponse.json({});
  }
}
