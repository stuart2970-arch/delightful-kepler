/**
 * STYL-312: legacy commercial plan_tier values map to Foundation catalogue rows
 * for entitlement lookups. Production may still store `ultimate` etc. on tenants.
 */

export const LEGACY_PLAN_TIERS = new Set(['basic', 'starter', 'premium', 'ultimate']);

const FOUNDATION_CATALOG_TIER_IDS = ['foundation', 'base_tier'] as const;

export function isLegacyPlanTier(planTier: string | null | undefined): boolean {
  if (!planTier) return false;
  return LEGACY_PLAN_TIERS.has(planTier.toLowerCase());
}

/**
 * Tier id used when reading tier_entitlements and subscription catalogue data.
 */
export function resolveEntitlementCatalogTierId(planTier: string | null | undefined): string {
  const tier = (planTier || 'foundation').toLowerCase();
  if (tier === 'base_tier') return 'foundation';
  if (LEGACY_PLAN_TIERS.has(tier)) return 'foundation';
  return tier;
}

export function foundationCatalogTierIds(): readonly string[] {
  return FOUNDATION_CATALOG_TIER_IDS;
}

/**
 * Hard cap for plan-included voice when the catalogue row is missing or unlimited (STYL-144).
 */
export function foundationVoiceMinutesCap(env: NodeJS.ProcessEnv = process.env): number {
  const raw = (env.BILLING_FOUNDATION_VOICE_MINUTES || '').trim();
  if (raw) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 10;
}