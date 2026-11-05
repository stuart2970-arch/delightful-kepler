import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

test.describe('STYL-226: inbound phone route schema', () => {
  test('inbound route does not select dropped chatbots.vapi_assistant_id', () => {
    const src = readFileSync(join(root, 'src/app/api/telephony/inbound/route.ts'), 'utf8');
    expect(src).not.toMatch(/\.select\([^)]*vapi_assistant_id/);
    expect(src).not.toContain("'id, name, vapi_assistant_id, configuration_json'");
  });

  test('unknown inbound number returns not-configured TwiML without a 500', async ({ request }) => {
    const res = await request.post('/api/telephony/inbound', {
      form: {
        To: '+447000000000',
        From: '+447111222333',
      },
    });
    expect(res.status()).toBeLessThan(500);
    const body = await res.text();
    expect(body.toLowerCase()).not.toMatch(/column.*vapi_assistant_id/i);
    expect(body.toLowerCase()).not.toMatch(/does not exist/);
    expect(body).toMatch(/not configured|Goodbye/i);
  });
});
