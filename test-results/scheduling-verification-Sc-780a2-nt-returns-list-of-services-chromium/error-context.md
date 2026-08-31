# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: scheduling-verification.spec.ts >> Scheduling & Staff Section Verification >> Services API endpoint returns list of services
- Location: tests\scheduling-verification.spec.ts:40:7

# Error details

```
Error: expect(received).toBeLessThan(expected)

Expected: < 500
Received:   500
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | 
  3  | test.describe('Scheduling & Staff Section Verification', () => {
  4  |   const testTenantId = 'e2e_test_tenant_123';
  5  | 
  6  |   test('Tenant Settings API handles calendar policies save without error', async ({ request }) => {
  7  |     const response = await request.patch('/api/tenants/settings', {
  8  |       data: {
  9  |         tenantId: testTenantId,
  10 |         bookingMode: 'single_calendar',
  11 |         bookingUrl: 'https://styleflo.ai',
  12 |         general_operating_hours: {
  13 |           monday: { closed: false, open: '09:00', close: '17:00' },
  14 |           tuesday: { closed: false, open: '09:00', close: '17:00' },
  15 |           wednesday: { closed: false, open: '09:00', close: '17:00' },
  16 |           thursday: { closed: false, open: '09:00', close: '17:00' },
  17 |           friday: { closed: false, open: '09:00', close: '17:00' },
  18 |           saturday: { closed: false, open: '09:00', close: '17:00' },
  19 |           sunday: { closed: true, open: '09:00', close: '17:00' }
  20 |         },
  21 |         flexible_breaks: true,
  22 |         is_24_7: false,
  23 |         open_public_holidays: false,
  24 |         max_advance_weeks: 12
  25 |       }
  26 |     });
  27 | 
  28 |     expect(response.status()).toBe(200);
  29 |     const body = await response.json();
  30 |     expect(body.success).toBeTruthy();
  31 |   });
  32 | 
  33 |   test('Google Calendar Integration status endpoint returns status structure', async ({ request }) => {
  34 |     const response = await request.get(`/api/integrations/google/status?tenantId=${testTenantId}`);
  35 |     expect(response.status()).toBe(200);
  36 |     const body = await response.json();
  37 |     expect(body).toHaveProperty('connected');
  38 |   });
  39 | 
  40 |   test('Services API endpoint returns list of services', async ({ request }) => {
  41 |     const response = await request.get(`/api/services?tenantId=${testTenantId}`);
> 42 |     expect(response.status()).toBeLessThan(500);
     |                               ^ Error: expect(received).toBeLessThan(expected)
  43 |   });
  44 | 
  45 |   test('Staff API endpoint returns list of colleagues', async ({ request }) => {
  46 |     const response = await request.get(`/api/staff?tenantId=${testTenantId}`);
  47 |     expect(response.status()).toBeLessThan(500);
  48 |   });
  49 | 
  50 |   test('Staff Member Creation & Update API validates avatar image, specialist services, bio, and 4-week shift rotas', async ({ request }) => {
  51 |     // 1. Test POST staff creation payload with all extended profile fields
  52 |     const createRes = await request.post('/api/staff', {
  53 |       data: {
  54 |         tenant_id: testTenantId,
  55 |         name: 'Jessica Taylor (Playwright Test)',
  56 |         email: 'jessica.e2e@styleflo.ai',
  57 |         google_calendar_id: 'primary',
  58 |         image_url: 'https://example.com/jessica-avatar.jpg',
  59 |         specialist_product: 'Balayage & Precision Haircuts',
  60 |         bio: 'Senior Stylist with 8+ years experience in colour transformations and hair health.',
  61 |         working_days: {
  62 |           weeks: [
  63 |             {
  64 |               weekCommencingDate: '2026-08-24',
  65 |               monday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
  66 |               tuesday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
  67 |               wednesday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
  68 |               thursday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
  69 |               friday: { unavailable: false, am: { start: '09:00', end: '13:00' }, pm: { start: '14:00', end: '18:00' } },
  70 |               saturday: { unavailable: true, am: null, pm: null },
  71 |               sunday: { unavailable: true, am: null, pm: null }
  72 |             }
  73 |           ]
  74 |         }
  75 |       }
  76 |     });
  77 | 
  78 |     expect(createRes.status()).toBeLessThan(500);
  79 |   });
  80 | });
  81 | 
```