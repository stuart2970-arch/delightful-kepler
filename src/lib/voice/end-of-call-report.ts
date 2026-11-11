import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { sendConsolidatedLeadEmail } from '@/lib/lead-notifier';
import { logMeteredUsage } from '@/lib/entitlements';

const VOICE_FEATURE_ID = 'vapi_voice_minutes';

type AdminClient = SupabaseClient;

export function unwrapVapiMessage(body: unknown): Record<string, any> | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, any>;
  if (record.message && typeof record.message === 'object') return record.message;
  if (typeof record.type === 'string') return record;
  return null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function callTranscript(message: Record<string, any>, call: Record<string, any>): string {
  const candidates = [
    message?.artifact?.transcript,
    call?.artifact?.transcript,
    message?.transcript,
    call?.transcript,
  ];
  for (const value of candidates) {
    const transcript = text(value);
    if (transcript) return transcript;
  }
  const messages = message?.artifact?.messages || call?.artifact?.messages;
  if (!Array.isArray(messages)) return '';
  const lines = messages
    .map((item) => {
      const spoken = text(item?.message || item?.content || item?.transcript);
      if (!spoken) return '';
      const role = item?.role === 'user' ? 'User' : 'AI';
      return `${role}: ${spoken}`;
    })
    .filter(Boolean);
  return lines.join('\n');
}

function durationMinutes(message: Record<string, any>, call: Record<string, any>): number {
  const started = text(message?.startedAt) || text(call?.startedAt);
  const ended = text(message?.endedAt) || text(call?.endedAt);
  if (started && ended) {
    const ms = Date.parse(ended) - Date.parse(started);
    if (Number.isFinite(ms) && ms > 0) return Math.ceil(ms / 60000);
  }
  const seconds = [message?.durationSeconds, call?.durationSeconds, message?.duration, call?.duration]
    .find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (typeof seconds === 'number') return Math.ceil(seconds / 60);
  const ms = [message?.durationMs, call?.durationMs]
    .find((value) => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (typeof ms === 'number') return Math.ceil(ms / 60000);
  return 0;
}

function metaValue(bags: unknown[], key: string): string {
  for (const bag of bags) {
    if (!bag || typeof bag !== 'object') continue;
    const value = text((bag as Record<string, unknown>)[key]);
    if (value) return value;
  }
  return '';
}

function phoneVariants(rawValues: unknown[]): string[] {
  const variants = new Set<string>();
  for (const raw of rawValues) {
    const trimmed = text(raw);
    if (!trimmed) continue;
    variants.add(trimmed);
    const digits = trimmed.replace(/\D/g, '');
    if (digits) {
      variants.add(digits);
      variants.add(`+${digits}`);
    }
  }
  return [...variants];
}

function calledNumbers(message: Record<string, any>, call: Record<string, any>): string[] {
  const phone = message?.phoneNumber ?? call?.phoneNumber;
  return phoneVariants([
    typeof phone === 'string' ? phone : phone?.number,
    message?.phoneNumber?.number,
    call?.to?.phoneNumber,
  ]);
}

function callerNumber(message: Record<string, any>, call: Record<string, any>): string | null {
  return text(call?.customer?.number) || text(message?.customer?.number) || null;
}

async function tenantFromChatbotId(supabase: AdminClient, chatbotId: string): Promise<string | null> {
  if (!chatbotId) return null;
  const { data } = await supabase.from('chatbots').select('tenant_id').eq('id', chatbotId).maybeSingle();
  return data?.tenant_id || null;
}

async function tenantFromAssistantId(supabase: AdminClient, assistantId: string): Promise<{ tenantId: string; chatbotId: string } | null> {
  if (!assistantId) return null;
  const { data } = await supabase
    .from('chatbots')
    .select('id, tenant_id')
    .filter('configuration_json->>vapi_assistant_id', 'eq', assistantId)
    .limit(2);
  if (!data || data.length !== 1 || !data[0]?.tenant_id) return null;
  return { tenantId: data[0].tenant_id, chatbotId: data[0].id };
}

async function tenantFromCalledNumber(supabase: AdminClient, numbers: string[]): Promise<string | null> {
  if (!numbers.length) return null;
  for (const column of ['twilio_shadow_number', 'twilio_mobile_number'] as const) {
    const { data } = await supabase.from('tenants').select('id').in(column, numbers).limit(1);
    if (data?.[0]?.id) return data[0].id;
  }
  return null;
}

async function chatbotForTenant(supabase: AdminClient, tenantId: string, preferredId: string): Promise<string | null> {
  if (preferredId) {
    const { data } = await supabase
      .from('chatbots')
      .select('id')
      .eq('id', preferredId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (data?.id) return data.id;
  }
  const { data } = await supabase.from('chatbots').select('id').eq('tenant_id', tenantId).limit(1);
  return data?.[0]?.id || null;
}

function adminClient(): AdminClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function handleEndOfCallReport(body: unknown): Promise<NextResponse> {
  const message = unwrapVapiMessage(body);
  if (!message || message.type !== 'end-of-call-report') {
    return NextResponse.json({ success: true, ignored: true });
  }

  const call = message.call;
  if (!call?.id) {
    return NextResponse.json({ error: 'Missing call id' }, { status: 400 });
  }
  const callId = String(call.id);
  const bags = [
    call.metadata,
    call.assistantOverrides?.metadata,
    call.assistantOverrides?.variableValues,
    call.assistant?.metadata,
    message.assistant?.metadata,
  ];
  const rawTenantId = metaValue(bags, 'tenant_id');
  const chatbotIdHint = metaValue(bags, 'chatbot_id');
  const sessionId = metaValue(bags, 'session_id') || callId;
  const transcript = callTranscript(message, call);
  const minutes = durationMinutes(message, call);
  const caller = callerNumber(message, call);
  const assistantId = text(call.assistantId) || text(call.assistant?.id) || text(message.assistant?.id);

  const supabase = adminClient();
  let tenantId = rawTenantId;
  let resolvedChatbotId = chatbotIdHint;

  if (rawTenantId) {
    const fromBot = await tenantFromChatbotId(supabase, rawTenantId);
    if (fromBot) tenantId = fromBot;
  }
  if (!tenantId && chatbotIdHint) {
    tenantId = await tenantFromChatbotId(supabase, chatbotIdHint) || '';
  }
  if (!tenantId && assistantId) {
    const fromAssistant = await tenantFromAssistantId(supabase, assistantId);
    if (fromAssistant) {
      tenantId = fromAssistant.tenantId;
      resolvedChatbotId = resolvedChatbotId || fromAssistant.chatbotId;
    }
  }
  if (!tenantId) {
    tenantId = await tenantFromCalledNumber(supabase, calledNumbers(message, call)) || '';
  }

  if (!tenantId) {
    console.warn('[Vapi Webhook] Unable to resolve tenant for call', callId);
    return NextResponse.json({ error: 'Unable to resolve tenant' }, { status: 500 });
  }

  const { error: claimError } = await supabase.from('vapi_call_ingest').insert({
    vapi_call_id: callId,
    tenant_id: tenantId,
  });
  if (claimError) {
    if (claimError.code === '23505') {
      return NextResponse.json({ success: true, duplicate: true });
    }
    console.error('[Vapi Webhook] Could not claim call', { callId, code: claimError.code });
    return NextResponse.json({ error: 'Could not store the call report' }, { status: 500 });
  }

  const releaseClaim = async () => {
    await supabase.from('vapi_call_ingest').delete().eq('vapi_call_id', callId);
  };

  try {
    const isPhoneCall = call.type === 'inboundPhoneCall'
      || call.type === 'outboundPhoneCall'
      || Boolean(call.phoneNumberId)
      || Boolean(message.phoneNumber)
      || sessionId.startsWith('phone_');
    const channel = isPhoneCall ? 'phone' : 'web_voice';

    let resultedInBooking = transcript.includes('[BOOK_MEETING:');
    if (!resultedInBooking && transcript) {
      const { data: tenant } = await supabase.from('tenants').select('booking_url').eq('id', tenantId).maybeSingle();
      if (tenant?.booking_url && transcript.includes(tenant.booking_url)) {
        resultedInBooking = true;
      }
    }

    const { data: existingConv, error: existingError } = await supabase
      .from('conversations')
      .select('id, chatbot_id')
      .eq('tenant_id', tenantId)
      .eq('user_session_id', sessionId)
      .maybeSingle();
    if (existingError) {
      await releaseClaim();
      console.error('[Vapi Webhook] Conversation lookup failed', { callId, code: existingError.code });
      return NextResponse.json({ error: 'Could not store the call report' }, { status: 500 });
    }

    let targetConvId: string | null = null;
    let targetChatbotId: string | null = null;
    const voiceFields = {
      is_voice_call: true,
      channel,
      resulted_in_booking: resultedInBooking,
      transcript,
      recording_url: null,
      ...(caller ? { caller_number: caller } : {}),
    };

    if (existingConv) {
      targetConvId = existingConv.id;
      targetChatbotId = existingConv.chatbot_id || null;
      const { error: updateError } = await supabase.from('conversations').update(voiceFields).eq('id', existingConv.id);
      if (updateError) {
        await releaseClaim();
        console.error('[Vapi Webhook] Conversation update failed', { callId, code: updateError.code });
        return NextResponse.json({ error: 'Could not store the call report' }, { status: 500 });
      }
    } else {
      const chatbotId = await chatbotForTenant(supabase, tenantId, resolvedChatbotId);
      if (!chatbotId) {
        await releaseClaim();
        console.warn('[Vapi Webhook] No chatbot for tenant', { callId, tenantId });
        return NextResponse.json({ error: 'Unable to resolve chatbot' }, { status: 500 });
      }
      targetChatbotId = chatbotId;
      const { data: newConv, error: insertError } = await supabase.from('conversations').insert({
        tenant_id: tenantId,
        chatbot_id: chatbotId,
        user_session_id: sessionId,
        ...voiceFields,
      }).select('id').single();
      if (insertError || !newConv?.id) {
        await releaseClaim();
        console.error('[Vapi Webhook] Conversation insert failed', { callId, code: insertError?.code });
        return NextResponse.json({ error: 'Could not store the call report' }, { status: 500 });
      }
      targetConvId = newConv.id;
    }

    if (minutes > 0) {
      await logMeteredUsage(supabase, tenantId, VOICE_FEATURE_ID, minutes, `Vapi call ${callId}`);
    }

    if (targetConvId && targetChatbotId) {
      try {
        await sendConsolidatedLeadEmail({
          tenantId,
          chatbotId: targetChatbotId,
          conversationId: targetConvId,
          newContactInfo: caller || '',
          channelType: 'voice',
          voiceTranscript: transcript,
          customerName: text(call.customer?.name) || text(message.customer?.name) || undefined,
        });
      } catch (emailErr) {
        console.error('[Vapi Webhook] Failed to send consolidated voice lead email', {
          callId,
          message: emailErr instanceof Error ? emailErr.message : 'unknown',
        });
      }
    }

    console.log('[Vapi Webhook] Stored end-of-call report', { callId, tenantId, minutes });
    return NextResponse.json({ success: true });
  } catch (err) {
    await releaseClaim();
    console.error('[Vapi Webhook] Error processing end-of-call report', {
      callId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
