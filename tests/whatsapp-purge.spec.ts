import { test, expect } from '@playwright/test';

test.describe('WhatsApp 90-day GDPR Message Retention Purge', () => {
  test('should execute 90-day retention purge endpoint successfully', async ({ request }) => {
    const res = await request.get('/api/gdpr/whatsapp-purge');
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.retention_days).toBe(90);
    expect(body).toHaveProperty('purged_before');
    expect(body).toHaveProperty('deleted_messages');
  });
});
