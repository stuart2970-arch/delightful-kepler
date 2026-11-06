import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildVapiPhoneImportPayload,
  fetchWithVendorTimeout,
  importTwilioNumberToVapi,
  isPendingReservationExpired,
  matchIncomingNumberForTenant,
  reclaimExpiredPendingPurchase,
  releaseTwilioIncomingNumber,
  reserveTenantPhonePurchase,
  tenantHasExistingNumber,
  tenantHasPaidPhoneAddon,
  verifyVapiPrivateKeyWorks,
  VENDOR_FETCH_TIMEOUT_MS,
} from '../src/lib/telephony/provision-safety';

const root = process.cwd();

test.describe('STYL-226: safer telephony provision', () => {
  test('source has no production URL or Twilio SID fallbacks and imports without assistantId', () => {
    const src = readFileSync(join(root, 'src/app/api/telephony/provision/route.ts'), 'utf8');
    const assistant = readFileSync(join(root, 'src/app/api/webhooks/vapi/assistant/route.ts'), 'utf8');
    expect(src).not.toContain('https://app.styleflo.ai');
    expect(assistant).not.toContain('https://app.styleflo.ai');
    expect(src).not.toContain('BUf676ba5c4a24f355ecdcc59d0e61e818');
    expect(src).not.toContain('AD11e6b1f650f21544d4ef5e9447fad0e5');
    const flow = readFileSync(join(root, 'src/lib/telephony/provision-flow.ts'), 'utf8');
    expect(src).toContain('handleProvisionPost');
    expect(flow).toContain('reserveTenantPhonePurchase');
    expect(flow).toContain('releaseTwilioIncomingNumber');
    expect(flow).toContain('deleteVapiPhoneNumber');
    expect(flow).toContain('recordOrphanedPhonePurchase');
    expect(flow).toContain('subscription_status');
    expect(flow).toMatch(/reserveTenantPhonePurchase[\s\S]*deps\.createTwilio\(/);
  });

  test('buy-once, paid bolt-on, Vapi key check, import payload, and release on import failure', async () => {
    expect(tenantHasExistingNumber({ twilio_shadow_number: '+441234567890' })).toBe(true);
    expect(tenantHasExistingNumber({ twilio_mobile_number: null, twilio_shadow_number: '' })).toBe(false);

    expect(
      tenantHasPaidPhoneAddon([
        { addon_catalog_id: 'landline_addon', is_active: true, subscription_status: 'active' },
      ]),
    ).toBe(true);
    expect(
      tenantHasPaidPhoneAddon([
        { addon_catalog_id: 'landline_addon', is_active: true, subscription_status: 'trialing' },
      ]),
    ).toBe(true);
    expect(
      tenantHasPaidPhoneAddon([
        { addon_catalog_id: 'landline_addon', is_active: true, price_paid_pence: 899 },
      ]),
    ).toBe(true);
    expect(
      tenantHasPaidPhoneAddon([
        { addon_catalog_id: 'landline_addon', is_active: true, subscription_status: 'past_due' },
      ]),
    ).toBe(true);
    expect(
      tenantHasPaidPhoneAddon([
        { addon_catalog_id: 'landline_addon', is_active: true, subscription_status: 'cancelled' },
      ]),
    ).toBe(false);
    expect(
      tenantHasPaidPhoneAddon([
        { addon_catalog_id: 'google_calendar_addon', is_active: true, subscription_status: 'active' },
      ]),
    ).toBe(false);

    const payload = buildVapiPhoneImportPayload({
      phoneNumber: '+441234567890',
      twilioAccountSid: 'ACmock',
      twilioAuthToken: 'token',
      tenantId: 'tenant-1',
      appUrl: 'https://staging.styleflo.ai',
      webhookSecret: 'hook-secret',
    });
    expect(payload).not.toHaveProperty('assistantId');
    expect(payload).not.toHaveProperty('serverUrl');
    expect(payload.server).toEqual({
      url: 'https://staging.styleflo.ai/api/webhooks/vapi/assistant',
      secret: 'hook-secret',
    });

    const keyOk = await verifyVapiPrivateKeyWorks(
      { VAPI_API_KEY: 'safe-test-vapi-private-key' },
      async (url) => {
        if (String(url).includes('/org')) {
          return new Response(JSON.stringify({ id: 'org_test' }), { status: 200 });
        }
        return new Response('no', { status: 404 });
      },
    );
    expect(keyOk.ok).toBe(true);

    const keyBad = await verifyVapiPrivateKeyWorks(
      { VAPI_API_KEY: 'safe-test-vapi-private-key' },
      async () => new Response('no', { status: 401 }),
    );
    expect(keyBad.ok).toBe(false);

    let released: string | null = null;
    const imported = await importTwilioNumberToVapi({
      payload,
      apiKey: 'safe-test-vapi-private-key',
      fetchImpl: async () => new Response('fail', { status: 500 }),
    });
    expect(imported.ok).toBe(false);
    await releaseTwilioIncomingNumber(
      {
        incomingPhoneNumbers: (sid: string) => ({
          remove: async () => {
            released = sid;
          },
        }),
      },
      'PNimported',
    );
    expect(released).toBe('PNimported');
  });

  test('only Postgres 23505 maps to a 409 reservation, and stale pending can expire', async () => {
    expect(VENDOR_FETCH_TIMEOUT_MS).toBe(15_000);
    expect(isPendingReservationExpired({
      status: 'pending',
      created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    })).toBe(true);
    expect(isPendingReservationExpired({
      status: 'pending',
      created_at: new Date().toISOString(),
    })).toBe(false);

    const unique = await reserveTenantPhonePurchase({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        insert: async () => ({ error: { code: '23505', message: 'duplicate key' } }),
        update: () => ({ eq: async () => ({ error: null }) }),
        delete: () => ({
          eq() { return this; },
          neq() { return this; },
          lt() { return this; },
          select: async () => ({ data: [], error: null }),
        }),
      }),
    } as any, 'tenant-1');
    expect(unique).toEqual(expect.objectContaining({ ok: false, status: 409 }));

    const other = await reserveTenantPhonePurchase({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        insert: async () => ({ error: { code: '42501', message: 'permission denied' } }),
        update: () => ({ eq: async () => ({ error: null }) }),
        delete: () => ({
          eq() { return this; },
          neq() { return this; },
          lt() { return this; },
          select: async () => ({ data: [], error: null }),
        }),
      }),
    } as any, 'tenant-1');
    expect(other).toEqual(expect.objectContaining({ ok: false, status: 500 }));
  });

  test('only one concurrent stale-reservation reclaim wins', async () => {
    const purchases: Array<Record<string, any>> = [{
      tenant_id: 'tenant-race',
      status: 'pending',
      created_at: new Date(Date.now() - 11 * 60 * 1000).toISOString(),
    }];
    let reclaimers = 0;
    const store = {
      from() {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: purchases[0] || null, error: null }),
            }),
          }),
          insert: async (row: Record<string, any>) => {
            if (purchases.some((item) => item.tenant_id === row.tenant_id)) {
              return { error: { code: '23505', message: 'duplicate key' } };
            }
            purchases.push({ created_at: new Date().toISOString(), ...row });
            return { error: null };
          },
          delete() {
            const chain: any = {
              eq() { return chain; },
              neq() { return chain; },
              lt() { return chain; },
              async select() {
                reclaimers += 1;
                if (reclaimers === 1) {
                  await new Promise((resolve) => setTimeout(resolve, 25));
                }
                const index = purchases.findIndex((row) => (
                  row.status === 'pending' && Date.parse(row.created_at) < Date.now() - 10 * 60 * 1000
                ));
                if (index < 0) return { data: [], error: null };
                const [row] = purchases.splice(index, 1);
                return { data: [row], error: null };
              },
            };
            return chain;
          },
        };
      },
    };
    const [first, second] = await Promise.all([
      reserveTenantPhonePurchase(store as any, 'tenant-race'),
      reserveTenantPhonePurchase(store as any, 'tenant-race'),
    ]);
    const outcomes = [first, second];
    expect(outcomes.filter((row) => row.ok)).toHaveLength(1);
    expect(outcomes.filter((row) => !row.ok && row.status === 409)).toHaveLength(1);
    expect(await reclaimExpiredPendingPurchase(store as any, 'tenant-race')).toEqual({
      reclaimed: false,
      error: null,
    });
    expect(purchases.filter((row) => row.status === 'pending')).toHaveLength(1);
  });

  test('incoming Twilio reconcile matches only the reserved number', () => {
    const other = {
      sid: 'PNOTHER',
      phoneNumber: '+449999999999',
      voiceUrl: 'https://staging.styleflo.ai/api/telephony/inbound',
    };
    const ours = {
      sid: 'PNOURS',
      phoneNumber: '+441234567890',
      voiceUrl: 'https://staging.styleflo.ai/api/telephony/inbound',
    };
    expect(matchIncomingNumberForTenant([other, ours], { phoneNumber: '+441234567890' })).toEqual(ours);
    expect(matchIncomingNumberForTenant([other], { phoneNumber: '+441234567890' })).toBeNull();
    expect(matchIncomingNumberForTenant([other, ours], { phoneNumber: null })).toBeNull();
  });

  test('only one concurrent unknown reservation claim wins', async () => {
    const purchases: Array<Record<string, any>> = [{
      tenant_id: 'tenant-unknown',
      status: 'unknown',
      phone_number: '+441234567890',
      created_at: new Date().toISOString(),
    }];
    let claimLock = Promise.resolve();
    const store = {
      from() {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: purchases[0] || null, error: null }),
            }),
          }),
          update(row: Record<string, any>) {
            const filters: Array<[string, string, any]> = [];
            const apply = () => {
              const next = claimLock.then(() => {
                const hits = purchases.filter((item) => filters.every(([op, col, val]) => (
                  op === 'eq' ? item[col] === val : true
                )));
                for (const item of hits) Object.assign(item, row);
                return { data: hits, error: null };
              });
              claimLock = next.then(() => undefined, () => undefined);
              return next;
            };
            const chain: any = {
              eq(column: string, value: string) {
                filters.push(['eq', column, value]);
                return chain;
              },
              select: apply,
              then(resolve: (value: any) => unknown, reject?: (reason: any) => unknown) {
                return apply().then(resolve, reject);
              },
            };
            return chain;
          },
          insert: async () => ({ error: { code: '23505', message: 'duplicate key' } }),
        };
      },
    };
    const [first, second] = await Promise.all([
      reserveTenantPhonePurchase(store as any, 'tenant-unknown'),
      reserveTenantPhonePurchase(store as any, 'tenant-unknown'),
    ]);
    const outcomes = [first, second];
    expect(outcomes.filter((row) => row.ok && 'reconcile' in row && row.reconcile)).toHaveLength(1);
    expect(outcomes.filter((row) => !row.ok && row.status === 409)).toHaveLength(1);
    expect(purchases.filter((row) => row.status === 'pending')).toHaveLength(1);
  });

  test('Vapi fetches use AbortController at 15s', async () => {
    const src = readFileSync(join(root, 'src/lib/telephony/provision-safety.ts'), 'utf8');
    expect(src).toContain('AbortController');
    expect(src).toContain('VENDOR_FETCH_TIMEOUT_MS');
    let sawSignal = false;
    await fetchWithVendorTimeout(async (_url, init) => {
      sawSignal = Boolean(init?.signal);
      return new Response('ok', { status: 200 });
    }, 'https://api.vapi.ai/org', { headers: {} });
    expect(sawSignal).toBe(true);
  });
});
