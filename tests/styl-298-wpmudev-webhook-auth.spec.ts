import { test, expect } from '@playwright/test';

test.describe('STYL-298: WPMU DEV webhook removed', () => {
  test('POST /api/webhooks/wpmudev is not a route', async ({ request }) => {
    const res = await request.post('/api/webhooks/wpmudev', {
      headers: { 'content-type': 'application/json', authorization: 'Bearer anything' },
      data: JSON.stringify({ email: 'should-not-provision@example.test', plan_tier: 'premium' }),
    });
    expect([404, 405]).toContain(res.status());
  });
});
