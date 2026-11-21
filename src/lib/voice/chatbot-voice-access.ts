import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateVoiceGate } from '@/lib/env/vapi-config';
import { INBOUND_MINUTES_EXHAUSTED_MESSAGE } from '@/lib/telephony/voice-minute-gate';
import { evaluateTenantVoiceMinuteGate } from '@/lib/telephony/tenant-voice-minute-gate';

export type ChatbotVoiceAccess = {
  allowed: boolean;
  reason?: string;
  voiceEnabled: boolean;
};

/**
 * Mirrors inbound telephony: voice is available when the runtime gate is on,
 * the bot has voice enabled, and the tenant is under the voice-minute allowance.
 */
export async function resolveChatbotVoiceAccess(
  supabase: SupabaseClient,
  chatbot: { id: string; tenant_id: string | null; voice_enabled: boolean | null },
): Promise<ChatbotVoiceAccess> {
  const voiceGate = evaluateVoiceGate();
  if (!voiceGate.allowed) {
    return { allowed: false, reason: voiceGate.reason, voiceEnabled: false };
  }

  if (!chatbot.voice_enabled) {
    return { allowed: false, reason: 'Voice is not enabled for this assistant.', voiceEnabled: false };
  }

  if (!chatbot.tenant_id) {
    return { allowed: false, reason: 'Chatbot is not linked to a tenant.', voiceEnabled: false };
  }

  const minuteGate = await evaluateTenantVoiceMinuteGate(supabase, chatbot.tenant_id);
  if (!minuteGate.decision.allowed && minuteGate.decision.blockedForAllowance) {
    return {
      allowed: false,
      reason: INBOUND_MINUTES_EXHAUSTED_MESSAGE,
      voiceEnabled: false,
    };
  }

  if (!minuteGate.decision.allowed) {
    return {
      allowed: false,
      reason: 'Voice is not available for this assistant.',
      voiceEnabled: false,
    };
  }

  return { allowed: true, voiceEnabled: true };
}