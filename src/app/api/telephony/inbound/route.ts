import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';
import { evaluateVoiceGate, getVapiMasterAssistantId } from '@/lib/env/vapi-config';
import {
  loadCurrentPeriodVoiceConsumption,
  loadPlanVoiceAllocationInLedger,
  loadPurchasedPackVoiceAllocationInLedger,
  loadRolloverBalance,
} from '@/lib/entitlements';
import { INBOUND_MINUTES_EXHAUSTED_MESSAGE } from '@/lib/telephony/voice-minute-gate';
import { evaluateTenantVoiceMinuteGate, type TenantVoiceMinuteSources } from '@/lib/telephony/tenant-voice-minute-gate';
import { verifyTwilioWebhookRequest } from '@/lib/env/twilio-webhook-auth';
import { findTenantByDialledTwilioNumber } from '@/lib/telephony/tenant-by-twilio-number';

export const dynamic = 'force-dynamic';

export type InboundMinuteSources = Pick<
  TenantVoiceMinuteSources,
  'loadBalance' | 'loadCatalog' | 'loadPeriodConsumption' | 'loadPlanVoiceInLedger' | 'loadPurchasedPackInLedger'
>;

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

export async function POST(request: Request) {
  return handleInboundPost(request);
}

export async function handleInboundPost(request: Request, sources?: Partial<InboundMinuteSources>) {
  const twilioAuth = await verifyTwilioWebhookRequest(request);
  if (!twilioAuth.ok) return twilioAuth.response;

  try {
    const supabase = getSupabaseAdmin();
    const minuteSources: InboundMinuteSources = {
      loadBalance: async (tenantId) => {
        const result = await loadRolloverBalance(tenantId, supabase);
        return {
          allocated: result.balance.voice_minutes_allocated,
          consumed: result.balance.voice_minutes_consumed,
          error: result.error,
        };
      },
      loadCatalog: async (planTier) => {
        const { data, error } = await supabase
          .from('tier_entitlements')
          .select('limit_value')
          .eq('tier_id', planTier)
          .eq('feature_id', 'voice_minutes')
          .maybeSingle();
        return { row: data, error };
      },
      loadPeriodConsumption: (tenantId) => loadCurrentPeriodVoiceConsumption(tenantId, supabase),
      loadPlanVoiceInLedger: (tenantId) => loadPlanVoiceAllocationInLedger(tenantId, supabase),
      loadPurchasedPackInLedger: (tenantId) => loadPurchasedPackVoiceAllocationInLedger(tenantId, supabase),
      ...sources,
    };
    const formData = await request.formData();
    const to = formData.get('To') as string;
    
    if (!to) {
      console.error('[Telephony Inbound] No To number provided by Twilio');
      return new NextResponse('Invalid request', { status: 400 });
    }

    const tenant = await findTenantByDialledTwilioNumber(supabase, to);

    if (!tenant) {
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

    // 2. Voice minutes. Purchased allocations use the 3-month balance.
    // With none in that window, this month's usage is compared with the plan's
    // monthly minutes. A failed read does not block the call.
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('plan_tier')
      .eq('id', tenant.id)
      .single();

    const planTier = tenantData?.plan_tier || 'foundation';

    const gateResult = await evaluateTenantVoiceMinuteGate(
      supabase,
      tenant.id,
      planTier,
      {
        loadBalance: minuteSources.loadBalance,
        loadCatalog: minuteSources.loadCatalog,
        loadPeriodConsumption: minuteSources.loadPeriodConsumption,
        ...(minuteSources.loadPlanVoiceInLedger
          ? { loadPlanVoiceInLedger: minuteSources.loadPlanVoiceInLedger }
          : {}),
        ...(minuteSources.loadPurchasedPackInLedger
          ? { loadPurchasedPackInLedger: minuteSources.loadPurchasedPackInLedger }
          : {}),
      },
      { logPrefix: '[Telephony Inbound]' },
    );
    const minuteGate = gateResult.decision;

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
