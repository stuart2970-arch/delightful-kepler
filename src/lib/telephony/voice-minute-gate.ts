/**
 * Inbound voice-minute gate (STYL-197).
 *
 * With no usage row, the plan catalogue (tier_entitlements.voice_minutes) is
 * the allowance. Once any allocation row exists, that ledger total is the
 * allowance, because checkout already writes the included minutes there.
 * A missing entitlement and no allocation, or a failed read, never blocks
 * the call. At or over a known allowance the caller hears the Terms message
 * and the route logs the block.
 */

export const INBOUND_MINUTES_EXHAUSTED_MESSAGE =
  'Thank you for calling. This business line has run out of voice minutes. Please reach out by text message or online.';

export type VoiceUsageRow = {
  quantity?: number | null;
  usage_type?: string | null;
};

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

export function catalogLimitFromRow(
  row: { limit_value: number | null } | null,
  lookupFailed: boolean,
): CatalogLimit {
  if (lookupFailed) return undefined;
  if (!row) return null;
  if (row.limit_value === null || row.limit_value === undefined) return 'unlimited';
  return Number(row.limit_value);
}

function sumByType(rows: VoiceUsageRow[], allocation: boolean): number {
  return rows.reduce((sum, row) => {
    const isAllocation = row.usage_type === 'allocation';
    if (isAllocation !== allocation) return sum;
    return sum + Number(row.quantity || 0);
  }, 0);
}

export function decideVoiceMinuteGate(input: {
  /** null when the usage_ledger read failed. */
  usageRows: VoiceUsageRow[] | null;
  /**
   * undefined: entitlement lookup failed.
   * null: no tier_entitlements row.
   * 'unlimited': limit_value is NULL.
   * number: the plan catalogue allowance.
   */
  catalogLimit: CatalogLimit;
}): VoiceMinuteGateDecision {
  if (input.usageRows === null || input.catalogLimit === undefined || input.catalogLimit === 'unlimited') {
    const consumed = input.usageRows ? sumByType(input.usageRows, false) : 0;
    return {
      allowed: true,
      blockedForAllowance: false,
      allowanceMinutes: null,
      consumedMinutes: consumed,
      reason: input.catalogLimit === 'unlimited' ? 'under_allowance' : 'fail_open',
    };
  }

  const rows = input.usageRows;
  const consumed = sumByType(rows, false);
  const allocated = sumByType(rows, true);
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
    reason: usedPlanDefault && rows.length === 0 ? 'plan_default' : 'under_allowance',
  };
}
