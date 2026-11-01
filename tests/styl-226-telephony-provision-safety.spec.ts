import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildVapiPhoneImportPayload,
  importTwilioNumberToVapi,
  releaseTwilioIncomingNumber,
  tenantHasExistingNumber,
  tenantHasPaidPhoneAddon,
  verifyVapiPrivateKeyWorks,
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
    expect(src).toContain('releaseTwilioIncomingNumber');
    expect(src).toContain('buildVapiPhoneImportPayload');
    expect(src).toContain('verifyVapiPrivateKeyWorks');
    expect(src).toContain('tenantHasExistingNumber');
    expect(src).toContain('tenantHasPaidPhoneAddon');
  });

  test('buy-once, paid bolt-on, Vapi key check, import payload, and release on import failure', async () => {
    expect(tenantHasExistingNumber({ twilio_shadow_number: '+441234567890' })).toBe(true);
    expect(tenantHasExistingNumber({ twilio_mobile_number: null, twilio_shadow_number: '' })).toBe(false);

    expect(
      tenantHasPaidPhoneAddon([
        { addon_catalog_id: 'landline_addon', is_active: true, price_paid_pence: 899 },
      ]),
    ).toBe(true);
    expect(
      tenantHasPaidPhoneAddon([
        { addon_catalog_id: 'google_calendar_addon', is_active: true, price_paid_pence: 500 },
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
});
