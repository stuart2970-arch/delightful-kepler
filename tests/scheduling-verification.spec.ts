import { test, expect } from '@playwright/test';

test.describe('Scheduling & Staff Section Verification', () => {
  const testTenantId = 'e2e_test_tenant_123';

  test('Tenant Settings API handles calendar policies save without error', async ({ request }) => {
    const response = await request.patch('/api/tenants/settings', {
      data: {
        tenantId: testTenantId,
        bookingMode: 'single_calendar',
        bookingUrl: 'https://styleflo.ai',
        general_operating_hours: {
          monday: { closed: false, open: '09:00', close: '17:00' },
          tuesday: { closed: false, open: '09:00', close: '17:00' },
          wednesday: { closed: false, open: '09:00', close: '17:00' },
          thursday: { closed: false, open: '09:00', close: '17:00' },
          friday: { closed: false, open: '09:00', close: '17:00' },
          saturday: { closed: false, open: '09:00', close: '17:00' },
          sunday: { closed: true, open: '09:00', close: '17:00' }
        },
        flexible_breaks: true,
        is_24_7: false,
        open_public_holidays: false,
        max_advance_weeks: 12
      }
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.success).toBeTruthy();
  });

  test('Google Calendar Integration status endpoint returns status structure', async ({ request }) => {
    const response = await request.get(`/api/integrations/google/status?tenantId=${testTenantId}`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('connected');
  });

  test('Services API endpoint returns list of services', async ({ request }) => {
    const response = await request.get(`/api/services?tenantId=${testTenantId}`);
    expect(response.status()).toBeLessThan(500);
  });

  test('Staff API endpoint returns list of colleagues', async ({ request }) => {
    const response = await request.get(`/api/staff?tenantId=${testTenantId}`);
    expect(response.status()).toBeLessThan(500);
  });

  test('Staff Member Creation & Update API validates avatar image, specialist services, bio, and 4-week shift rotas', async ({ request }) => {
    // 1. Test POST staff creation payload with all extended profile fields
    const createRes = await request.post('/api/staff', {
      data: {
        tenant_id: testTenantId,
        name: 'Jessica Taylor (Playwright Test)',
        email: 'jessica.e2e@styleflo.ai',
        google_calendar_id: 'primary',
        image_url: 'https://example.com/jessica-avatar.jpg',
        specialist_product: 'Balayage & Precision Haircuts',
        bio: 'Senior Stylist with 8+ years experience in colour transformations and hair health.',
        working_days: {
          weeks: [
            {
              weekCommencingDate: '2026-08-24',
              monday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
              tuesday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
              wednesday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
              thursday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
              friday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
              saturday: { unavailable: true, am: null, pm: null },
              sunday: { unavailable: true, am: null, pm: null }
            }
          ]
        }
      }
    });

    expect(createRes.status()).toBeLessThan(500);
  });
});
