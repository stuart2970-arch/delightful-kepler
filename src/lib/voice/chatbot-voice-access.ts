import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateVoiceGate } from '@/lib/env/vapi-config';
import { checkFeatureEntitlement } from '@/lib/entitlements';

const TIERS_WITH_INCLUDED_VOICE = new Set([
  'base_tier',
  'foundation',
  'starter',
  'premium',
  'ultimate',
  'trial',
]);

export type ChatbotVoiceAccess = {
  allowed: boolean;
  reason?: string;
  voiceEnabled: boolean;
};

/**
 * Mirrors public chatbot config: voice is available when the runtime gate is on,
 * the bot has voice enabled, and the tenant still has voice minutes allowance.
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

  const { data: tenant, error: tenantError } = await supabase
    .from('tenants')
    .select('plan_tier')
    .eq('id', chatbot.tenant_id)
    .maybeSingle();
  if (tenantError) {
    console.warn('[Voice access] Tenant lookup failed', tenantError.message);
    return { allowed: false, reason: 'Could not verify voice entitlement.', voiceEnabled: true };
  }

  const planTier = tenant?.plan_tier || 'foundation';
  let hasVoiceAllowance = TIERS_WITH_INCLUDED_VOICE.has(planTier);

  if (!hasVoiceAllowance) {
    const { data: voiceUsage } = await supabase
      .from('usage_ledger')
      .select('quantity, usage_type')
      .eq('tenant_id', chatbot.tenant_id)
      .in('feature_id', ['voice_minutes', 'vapi_voice_minutes', 'voice_agent_minutes_web']);

    if (voiceUsage && voiceUsage.length > 0) {
      const allocated = voiceUsage
        .filter((row) => row.usage_type === 'allocation')
        .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      const consumed = voiceUsage
        .filter((row) => row.usage_type === 'consumption')
        .reduce((sum, row) => sum + Number(row.quantity || 0), 0);
      hasVoiceAllowance = allocated - consumed > 0;
    }
  }

  if (!hasVoiceAllowance) {
    const entitlement = await checkFeatureEntitlement(supabase, chatbot.tenant_id, 'voice_minutes', 1);
    if (!entitlement.allowed) {
      return {
        allowed: false,
        reason: entitlement.error || 'Voice minutes quota exceeded.',
        voiceEnabled: true,
      };
    }
    hasVoiceAllowance = true;
  }

  return { allowed: hasVoiceAllowance, voiceEnabled: true };
}