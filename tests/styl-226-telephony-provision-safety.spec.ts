import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildVapiPhoneImportPayload,
  fetchWithVendorTimeout,
  importTwilioNumberToVapi,
  isPendingReservationExpired,
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
        delete: () => ({ eq: async () => ({ error: null }) }),
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
        delete: () => ({ eq: async () => ({ error: null }) }),
      }),
    } as any, 'tenant-1');
    expect(other).toEqual(expect.objectContaining({ ok: false, status: 500 }));
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
