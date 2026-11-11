import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { loadVoiceSalon } from '../src/lib/voice-salon';
import { formatOpeningHoursForPrompt, normaliseOpeningHours } from '../src/lib/opening-hours';

/**
 * STYL-245: voice routes must not select tenants.currency, tenants.timezone,
 * or services.base_price. Those columns are not on staging or production.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321';
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

test.describe('STYL-245 voice hours and service price', () => {
  test('saved opening hours and the price column load for a voice caller', async ({ request }) => {
    const stamp = Date.now();
    const tenantId = crypto.randomUUID();
    const botId = crypto.randomUUID();
    const hours = {
      monday: { closed: false, open: '10:00', close: '16:00' },
      saturday: { closed: true, open: '09:00', close: '17:00' },
      sunday: { closed: true, open: '09:00', close: '17:00' },
    };

    const { error: tenantError } = await admin.from('tenants').insert({
      id: tenantId,
      company_name: `Voice Hours ${stamp}`,
      slug: `voice-hours-${stamp}`,
      general_operating_hours: hours,
    });
    expect(tenantError).toBeNull();

    const { error: botError } = await admin.from('chatbots').insert({
      id: botId,
      tenant_id: tenantId,
      name: 'Voice Reception',
      configuration_json: { timezone: 'Europe/London', currency: '£' },
    });
    expect(botError).toBeNull();

    const { error: serviceError } = await admin.from('services').insert({
      tenant_id: tenantId,
      chatbot_id: botId,
      name: 'Cut and finish',
      price: 42,
      duration_minutes: 30,
    });
    expect(serviceError).toBeNull();

    try {
      const salon = await loadVoiceSalon(admin, tenantId, botId);
      expect(salon.tenantError).toBeNull();
      expect(salon.servicesError).toBeNull();
      expect(salon.tenant?.company_name).toBe(`Voice Hours ${stamp}`);
      expect(salon.services[0]?.price).toBe(42);
      expect(salon.services[0]).not.toHaveProperty('base_price');

      const spoken = formatOpeningHoursForPrompt(
        normaliseOpeningHours(salon.tenant?.general_operating_hours),
        { spoken: true, is24_7: salon.tenant?.is_24_7 === true },
      );
      expect(spoken).toContain('Monday: 10:00 to 16:00');
      expect(spoken).toContain('Tuesday: not saved');
      expect(spoken).not.toContain('Tuesday: 09:00');

      const response = await request.post(`/api/voice/${botId}/chat/completions`, {
        data: {
          sessionId: `voice-${stamp}`,
          messages: [{ role: 'user', content: 'What time do you open on Monday?' }],
          mockModelReply: 'We open at ten.',
        },
      });
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain('We open at ten.');
    } finally {
      await admin.from('tenants').delete().eq('id', tenantId);
    }
  });
});
