import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';
import { evaluateVoiceGate, getVapiMasterAssistantId } from '@/lib/env/vapi-config';
import {
  catalogLimitFromRow,
  decideVoiceMinuteGate,
  INBOUND_MINUTES_EXHAUSTED_MESSAGE,
} from '@/lib/telephony/voice-minute-gate';

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

    // 2. Voice minutes. No entitlement or usage row falls back to the plan
    // catalogue and does not block. At or over a known allowance, the Terms
    // message is played and the block is logged.
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('plan_tier')
      .eq('id', tenant.id)
      .single();

    const planTier = tenantData?.plan_tier || 'foundation';

    const { data: voiceUsage, error: usageError } = await supabase
      .from('usage_ledger')
      .select('quantity, usage_type')
      .eq('tenant_id', tenant.id)
      .in('feature_id', ['voice_minutes', 'vapi_voice_minutes', 'voice_agent_minutes_web']);

    const { data: entitlement, error: entitlementError } = await supabase
      .from('tier_entitlements')
      .select('limit_value')
      .eq('tier_id', planTier)
      .eq('feature_id', 'voice_minutes')
      .maybeSingle();

    if (usageError) {
      console.error(`[Telephony Inbound] usage_ledger read failed for tenant ${tenant.id}; allowing the call.`, usageError.message);
    }
    if (entitlementError) {
      console.error(`[Telephony Inbound] voice allowance read failed for tenant ${tenant.id}; allowing the call.`, entitlementError.message);
    }

    const minuteGate = decideVoiceMinuteGate({
      usageRows: usageError ? null : (voiceUsage || []),
      catalogLimit: catalogLimitFromRow(entitlement ?? null, Boolean(entitlementError)),
    });

    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    const voiceGate = evaluateVoiceGate();
    if (!voiceGate.allowed) {
      twiml.say({ voice: 'Polly.Amy' }, 'Voice is currently unavailable.');
      return new NextResponse(twiml.toString(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    if (!minuteGate.allowed) {
      console.warn(
        `[Telephony Inbound] BLOCK tenant=${tenant.id} plan=${planTier} allowance=${minuteGate.allowanceMinutes} consumed=${minuteGate.consumedMinutes} reason=${minuteGate.reason}`,
      );
      twiml.say({ voice: 'Polly.Amy' }, INBOUND_MINUTES_EXHAUSTED_MESSAGE);
      return new NextResponse(twiml.toString(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    if (minuteGate.reason === 'fail_open') {
      console.warn(
        `[Telephony Inbound] No voice allowance on file for tenant ${tenant.id}; allowing the call (plan ${planTier}).`,
      );
    }

    // 3. Resolve the Vapi assistant ID for this tenant's chatbot
    const { data: chatbots } = await supabase
      .from('chatbots')
      .select('id, name, configuration_json')
      .eq('tenant_id', tenant.id)
      .limit(5);

    const activeBot = (chatbots || []).find((b) => {
      const fromConfig = (b?.configuration_json as { vapi_assistant_id?: string } | null)?.vapi_assistant_id;
      return Boolean(fromConfig && !fromConfig.startsWith('vapi-'));
    }) || (chatbots || [])[0];
    const rawBotAssistantId = (activeBot?.configuration_json as { vapi_assistant_id?: string } | null)?.vapi_assistant_id;
    const resolvedAssistantId = (rawBotAssistantId && !rawBotAssistantId.startsWith('vapi-'))
      ? rawBotAssistantId
      : getVapiMasterAssistantId();

    if (!resolvedAssistantId) {
      twiml.say('Sorry, this number is not configured correctly. Goodbye.');
      return new NextResponse(twiml.toString(), {
        status: 200,
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    console.log(`[Telephony Inbound] Forwarding call for tenant ${tenant.id} to Vapi handler (allowance: ${minuteGate.allowanceMinutes ?? 'open'}, consumed: ${minuteGate.consumedMinutes}, plan: ${planTier}, reason: ${minuteGate.reason})`);
    twiml.redirect('https://api.vapi.ai/twilio/inbound_call');

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
