import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Stripe from 'stripe';
import { POST } from '../src/app/api/webhooks/stripe/route';

const root = process.cwd();
const TEST_SECRET = 'whsec_styl226_test_signing_secret';

function signedHeaders(payload: string, secret = TEST_SECRET) {
  return {
    'content-type': 'application/json',
    'stripe-signature': Stripe.webhooks.generateTestHeaderString({
      payload,
      secret,
    }),
  };
}

test.describe('STYL-226: Stripe webhook signature verification', () => {
  test('route source calls constructEvent', () => {
    const routeSrc = readFileSync(join(root, 'src/app/api/webhooks/stripe/route.ts'), 'utf8');
    const helperSrc = readFileSync(join(root, 'src/lib/env/stripe-webhook.ts'), 'utf8');
    expect(routeSrc + helperSrc).toMatch(/constructEvent/);
    expect(helperSrc).toContain('STRIPE_WEBHOOK_SECRET');
    expect(routeSrc).toContain('parseStripeWebhookEvent');
  });

  test('POST without a signature is rejected with 400', async () => {
    const previous = process.env.STRIPE_WEBHOOK_SECRET;
    const appEnv = process.env.APP_ENV;
    try {
      process.env.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
      process.env.APP_ENV = 'staging';
      const res = await POST(
        new Request('http://localhost:3001/api/webhooks/stripe', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'ping', data: { object: {} } }),
        }),
      );
      expect(res.status).toBe(400);
    } finally {
      if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previous;
      if (appEnv === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = appEnv;
    }
  });

  test('POST with a forged signature is rejected with 400', async () => {
    const previous = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      process.env.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
      const payload = JSON.stringify({ type: 'ping', data: { object: {} } });
      const res = await POST(
        new Request('http://localhost:3001/api/webhooks/stripe', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'stripe-signature': 't=1,v1=deadbeef',
          },
          body: payload,
        }),
      );
      expect(res.status).toBe(400);
    } finally {
      if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previous;
    }
  });

  test('POST signed by the test secret is accepted for an unknown event type', async () => {
    const previous = process.env.STRIPE_WEBHOOK_SECRET;
    try {
      process.env.STRIPE_WEBHOOK_SECRET = TEST_SECRET;
      const payload = JSON.stringify({
        id: 'evt_styl226_unknown',
        object: 'event',
        type: 'styl226.unknown',
        data: { object: {} },
      });
      const res = await POST(
        new Request('http://localhost:3001/api/webhooks/stripe', {
          method: 'POST',
          headers: signedHeaders(payload),
          body: payload,
        }),
      );
      expect(res.status).toBe(200);
    } finally {
      if (previous === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
      else process.env.STRIPE_WEBHOOK_SECRET = previous;
    }
  });
});
