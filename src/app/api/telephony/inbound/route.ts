import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const formData = await request.formData();
    const to = formData.get('To') as string;
    
    if (!to) {
      console.error('[Telephony Inbound] No To number provided by Twilio');
      return new NextResponse('Invalid request', { status: 400 });
    }

    // 1. Find the tenant by landline (twilio_shadow_number) or mobile (twilio_mobile_number)
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id')
      .or(`twilio_shadow_number.eq.${to},twilio_mobile_number.eq.${to}`)
      .limit(1)
      .maybeSingle();

    if (tenantError || !tenant) {
      console.error(`[Telephony Inbound] No tenant found for number: ${to}`);
      // Fallback TwiML if no tenant found
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const twiml = new VoiceResponse();
      twiml.say('Sorry, this number is not configured correctly. Goodbye.');
      return new NextResponse(twiml.toString(), {
        status: 200,
        headers: {
          'Content-Type': 'text/xml',
        },
      });
    }

    // 2. Check tenant voice minutes entitlement from usage_ledger (purchased numbers & bolt-ons)
    const { data: voiceUsage } = await supabase
      .from('usage_ledger')
      .select('quantity, usage_type')
      .eq('tenant_id', tenant.id)
      .in('feature_id', ['voice_minutes', 'vapi_voice_minutes', 'voice_agent_minutes_web']);

    const allocatedMinutes = (voiceUsage || [])
      .filter(u => u.usage_type === 'allocation')
      .reduce((s, u) => s + (u.quantity || 0), 0);
    const consumedMinutes = (voiceUsage || [])
      .filter(u => u.usage_type === 'consumption')
      .reduce((s, u) => s + (u.quantity || 0), 0);
    const remainingMinutes = Math.max(0, allocatedMinutes - consumedMinutes);

    // Also check plan tier included voice
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('plan_tier')
      .eq('id', tenant.id)
      .single();

    const planTier = tenantData?.plan_tier || 'basic';
    const tierHasVoice = ['base_tier', 'starter', 'premium', 'ultimate', 'trial'].includes(planTier);

    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    if (remainingMinutes <= 0 && !tierHasVoice) {
      console.warn(`[Telephony Inbound] Tenant ${tenant.id} has exhausted voice minutes.`);
      twiml.say({ voice: 'Polly.Amy' }, 'Thank you for calling. This business line has run out of voice minutes. Please reach out by text message or online.');
      return new NextResponse(twiml.toString(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // 3. Resolve the Vapi assistant ID for this tenant's chatbot
    const { data: chatbots } = await supabase
      .from('chatbots')
      .select('id, name, vapi_assistant_id, configuration_json')
      .eq('tenant_id', tenant.id)
      .limit(5);

    const activeBot = (chatbots || []).find(b => b.vapi_assistant_id && !b.vapi_assistant_id.startsWith('vapi-')) || (chatbots || [])[0];
    const rawBotAssistantId = activeBot?.vapi_assistant_id || (activeBot?.configuration_json as any)?.vapi_assistant_id;

    const resolvedAssistantId = (rawBotAssistantId && !rawBotAssistantId.startsWith('vapi-'))
      ? rawBotAssistantId
      : (process.env.VAPI_MASTER_ASSISTANT_ID || '1bb95940-1cb9-4c54-9b16-ba5bc11daae2');

    console.log(`[Telephony Inbound] Connecting call to Vapi SIP Assistant ${resolvedAssistantId} (tenant has ${remainingMinutes} mins remaining, plan: ${planTier})`);
    const dial = twiml.dial();
    dial.sip(`sip:${resolvedAssistantId}@sip.vapi.ai;transport=tls`);

    return new NextResponse(twiml.toString(), {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    });

  } catch (error: any) {
    console.error('[Telephony Inbound API] Unexpected error:', error);
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    twiml.say('An unexpected error occurred. Please try again later.');
    return new NextResponse(twiml.toString(), {
        status: 500,
        headers: {
            'Content-Type': 'text/xml',
        },
    });
  }
}
