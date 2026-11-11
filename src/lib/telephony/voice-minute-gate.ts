/**
 * Inbound voice-minute gate (STYL-197).
 *
 * Allocated and consumed minutes come from the dashboard rolling balance
 * (getRolloverBalance / loadRolloverBalance). Expired allocations and usage
 * outside that window are not counted. With no allocation in the window, the
 * plan catalogue is the allowance. A missing entitlement, or a failed read,
 * never blocks the call. At or over a known allowance the caller hears the
 * holding line below. Final wording is still with the solicitor.
 */

export const INBOUND_MINUTES_EXHAUSTED_MESSAGE =
  "We can't take your call right now. Please contact us through our website or by text message.";

export type CatalogLimit = number | 'unlimited' | null | undefined;

export type VoiceMinuteGateReason =
  | 'under_allowance'
  | 'at_allowance'
  | 'plan_default'
  | 'fail_open';

export type VoiceMinuteGateDecision = {
  allowed: boolean;
  blockedForAllowance: boolean;
  allowanceMinutes: number | null;
  consumedMinutes: number;
  reason: VoiceMinuteGateReason;
};

export type VoiceMinuteBalance = {
  allocated: number;
  consumed: number;
};

export function catalogLimitFromRow(
  row: { limit_value: number | null } | null,
  lookupFailed: boolean,
): CatalogLimit {
  if (lookupFailed) return undefined;
  if (!row) return null;
  if (row.limit_value === null || row.limit_value === undefined) return 'unlimited';
  return Number(row.limit_value);
}

export function decideVoiceMinuteGate(input: {
  /** null when the rolling-balance read failed. */
  balance: VoiceMinuteBalance | null;
  /**
   * undefined: entitlement lookup failed.
   * null: no tier_entitlements row.
   * 'unlimited': limit_value is NULL.
   * number: the plan catalogue allowance.
   */
  catalogLimit: CatalogLimit;
}): VoiceMinuteGateDecision {
  if (input.balance === null || input.catalogLimit === undefined) {
    return {
      allowed: true,
      blockedForAllowance: false,
      allowanceMinutes: null,
      consumedMinutes: input.balance?.consumed ?? 0,
      reason: 'fail_open',
    };
  }

  if (input.catalogLimit === 'unlimited') {
    return {
      allowed: true,
      blockedForAllowance: false,
      allowanceMinutes: null,
      consumedMinutes: input.balance.consumed,
      reason: 'under_allowance',
    };
  }

  const allocated = Number(input.balance.allocated || 0);
  const consumed = Number(input.balance.consumed || 0);
  const catalog = input.catalogLimit;

  if (catalog === null && allocated <= 0) {
    return {
      allowed: true,
      blockedForAllowance: false,
      allowanceMinutes: null,
      consumedMinutes: consumed,
      reason: 'fail_open',
    };
  }

  const usedPlanDefault = allocated <= 0;
  const allowance = usedPlanDefault ? Number(catalog) : allocated;
  const atAllowance = consumed >= allowance;

  if (atAllowance) {
    return {
      allowed: false,
      blockedForAllowance: true,
      allowanceMinutes: allowance,
      consumedMinutes: consumed,
      reason: 'at_allowance',
    };
  }

  return {
    allowed: true,
    blockedForAllowance: false,
    allowanceMinutes: allowance,
    consumedMinutes: consumed,
    reason: usedPlanDefault && consumed === 0 ? 'plan_default' : 'under_allowance',
  };
}
