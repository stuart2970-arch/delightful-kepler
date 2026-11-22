import { test, expect } from '@playwright/test';
import {
  isLegacyPlanTier,
  resolveEntitlementCatalogTierId,
  foundationVoiceMinutesCap,
} from '../src/lib/billing/plan-tier-catalog';
import { resolveVoiceCatalogLimit } from '../src/lib/billing/voice-catalog-limit';
import { decideVoiceMinuteGate } from '../src/lib/telephony/voice-minute-gate';
import { evaluateTenantVoiceMinuteGate } from '../src/lib/telephony/tenant-voice-minute-gate';

test.describe('STYL-312 legacy plan tier voice cap', () => {
  test('ultimate maps to the Foundation catalogue tier', () => {
    expect(isLegacyPlanTier('ultimate')).toBe(true);
    expect(resolveEntitlementCatalogTierId('ultimate')).toBe('foundation');
    expect(resolveEntitlementCatalogTierId('starter')).toBe('foundation');
    expect(resolveEntitlementCatalogTierId('premium')).toBe('foundation');
    expect(resolveEntitlementCatalogTierId('trial')).toBe('trial');
  });

  test('missing or unlimited catalogue rows cap at Foundation minutes', () => {
    const cap = foundationVoiceMinutesCap();
    expect(
      resolveVoiceCatalogLimit({
        row: null,
        lookupFailed: false,
        planTier: 'ultimate',
      }),
    ).toBe(cap);
    expect(
      resolveVoiceCatalogLimit({
        row: { limit_value: null },
        lookupFailed: false,
        planTier: 'ultimate',
      }),
    ).toBe(cap);
  });

  test('legacy ultimate with no catalogue row blocks at the Foundation cap', () => {
    expect(
      decideVoiceMinuteGate({
        balance: { allocated: 0, consumed: 10 },
        catalogLimit: 10,
      }),
    ).toMatchObject({ allowed: false, blockedForAllowance: true, allowanceMinutes: 10 });
  });

  test('evaluateTenantVoiceMinuteGate resolves ultimate through Foundation catalogue', async () => {
    const result = await evaluateTenantVoiceMinuteGate(
      {} as never,
      '00000000-0000-0000-0000-000000000001',
      'ultimate',
      {
        loadBalance: async () => ({ allocated: 0, consumed: 10, error: null }),
        loadCatalog: async (planTier) => {
          expect(planTier).toBe('ultimate');
          return { row: null, error: null };
        },
        loadPeriodConsumption: async () => ({ consumed: 10, error: null }),
        loadPlanVoiceInLedger: async () => ({ quantity: 0, error: null }),
        loadPurchasedPackInLedger: async () => ({ quantity: 0, error: null }),
      },
    );
    expect(result.catalogLimit).toBe(foundationVoiceMinutesCap());
    expect(result.decision).toMatchObject({
      allowed: false,
      blockedForAllowance: true,
      reason: 'at_allowance',
    });
  });
});