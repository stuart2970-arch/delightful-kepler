import type { SupabaseClient } from '@supabase/supabase-js';
import {
  loadCurrentPeriodVoiceConsumption,
  loadPlanVoiceAllocationInLedger,
  loadPurchasedPackVoiceAllocationInLedger,
  loadRolloverBalance,
} from '@/lib/entitlements';
import {
  catalogLimitFromRow,
  decideVoiceMinuteGate,
  buildVoiceMinuteGateBalance,
  resolveVoiceAllowance,
  type CatalogLimit,
  type VoiceMinuteGateDecision,
} from '@/lib/telephony/voice-minute-gate';

export type TenantVoiceMinuteSources = {
  loadBalance: (tenantId: string) => Promise<{ allocated: number; consumed: number; error: string | null }>;
  loadCatalog: (planTier: string) => Promise<{
    row: { limit_value: number | null } | null;
    error: { message: string } | null;
  }>;
  loadPeriodConsumption: (tenantId: string) => Promise<{ consumed: number; error: string | null }>;
  loadPlanVoiceInLedger: (tenantId: string) => Promise<{ quantity: number; error: string | null }>;
  loadPurchasedPackInLedger: (tenantId: string) => Promise<{ quantity: number; error: string | null }>;
};

function defaultSources(supabase: SupabaseClient): TenantVoiceMinuteSources {
  return {
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
  };
}

export type TenantVoiceMinuteGateResult = {
  decision: VoiceMinuteGateDecision;
  planTier: string;
  catalogLimit: CatalogLimit;
};

/**
 * Shared voice-minute gate for inbound telephony, the website widget, and web calls.
 */
export async function evaluateTenantVoiceMinuteGate(
  supabase: SupabaseClient,
  tenantId: string,
  planTierInput?: string | null,
  sourceOverrides?: Partial<TenantVoiceMinuteSources>,
  options?: { logPrefix?: string },
): Promise<TenantVoiceMinuteGateResult> {
  const logPrefix = options?.logPrefix;
  const sources: TenantVoiceMinuteSources = { ...defaultSources(supabase), ...sourceOverrides };

  let planTier = planTierInput || 'foundation';
  if (!planTierInput) {
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('plan_tier')
      .eq('id', tenantId)
      .maybeSingle();
    planTier = tenantData?.plan_tier || 'foundation';
  }

  const balanceRead = await sources.loadBalance(tenantId);
  const entitlementRead = await sources.loadCatalog(planTier);
  if (logPrefix && balanceRead.error) {
    console.error(`${logPrefix} usage_ledger read failed for tenant ${tenantId}; allowing the call.`, balanceRead.error);
  }
  if (logPrefix && entitlementRead.error) {
    console.error(
      `${logPrefix} voice allowance read failed for tenant ${tenantId}; allowing the call.`,
      entitlementRead.error.message,
    );
  }
  const catalogLimit: CatalogLimit = catalogLimitFromRow(entitlementRead.row ?? null, Boolean(entitlementRead.error));

  let periodError: string | null = null;
  let currentPeriodConsumed = balanceRead.consumed;
  if (!balanceRead.error && balanceRead.allocated <= 0 && catalogLimit !== undefined) {
    const period = await sources.loadPeriodConsumption(tenantId);
    if (period.error) {
      periodError = period.error;
      if (logPrefix) {
        console.error(`${logPrefix} usage_ledger read failed for tenant ${tenantId}; allowing the call.`, period.error);
      }
    } else {
      currentPeriodConsumed = period.consumed;
    }
  }

  const comparable = resolveVoiceAllowance({
    rolloverAllocated: balanceRead.allocated,
    rolloverConsumed: balanceRead.consumed,
    planMinutes: typeof catalogLimit === 'number' ? catalogLimit : null,
    currentPeriodConsumed,
  });

  let planVoiceInLedger = 0;
  let purchasedPackInLedger = 0;
  let ledgerSplitError: string | null = null;
  if (!balanceRead.error && balanceRead.allocated > 0) {
    const [planVoice, purchasedPack] = await Promise.all([
      sources.loadPlanVoiceInLedger(tenantId),
      sources.loadPurchasedPackInLedger(tenantId),
    ]);
    planVoiceInLedger = planVoice.quantity;
    purchasedPackInLedger = purchasedPack.quantity;
    ledgerSplitError = planVoice.error || purchasedPack.error;
  }

  const balance =
    balanceRead.error || periodError || ledgerSplitError
      ? null
      : buildVoiceMinuteGateBalance({
          rolloverAllocated: balanceRead.allocated,
          consumed: comparable.consumed,
          catalogLimit,
          planVoiceAllocatedInLedger: planVoiceInLedger,
          purchasedPackAllocationInLedger: purchasedPackInLedger,
        });

  const decision = decideVoiceMinuteGate({ balance, catalogLimit });

  return { decision, planTier, catalogLimit };
}