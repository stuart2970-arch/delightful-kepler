import { foundationVoiceMinutesCap } from './plan-tier-catalog';
import type { CatalogLimit } from '../telephony/voice-minute-gate';

export type VoiceEntitlementRow = { limit_value: number | null } | null;

/**
 * Normalises tier_entitlements voice_minutes into a finite plan cap (never unlimited).
 */
export function resolveVoiceCatalogLimit(input: {
  row: VoiceEntitlementRow;
  lookupFailed: boolean;
  planTier: string;
  env?: NodeJS.ProcessEnv;
}): CatalogLimit {
  if (input.lookupFailed) return undefined;

  const foundationCap = foundationVoiceMinutesCap(input.env);

  if (!input.row) {
    return foundationCap;
  }

  const raw = input.row.limit_value;
  if (raw === null || raw === undefined) {
    return foundationCap;
  }

  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes < 0) {
    return foundationCap;
  }

  return minutes;
}