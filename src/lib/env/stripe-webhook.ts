import Stripe from 'stripe';

export type StripeWebhookParseResult =
  | { ok: true; event: Stripe.Event }
  | { ok: false; error: string };

function isDeployedAppEnv(env: NodeJS.ProcessEnv): boolean {
  const appEnv = (env.APP_ENV || env.NEXT_PUBLIC_ENV || '').trim().toLowerCase();
  if (appEnv === 'staging' || appEnv === 'production') return true;
  if (appEnv) return false;
  return (env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

/**
 * Verify stripe-signature with STRIPE_WEBHOOK_SECRET.
 * Staging and production require the secret; unsigned events are rejected.
 */
export function parseStripeWebhookEvent(
  payload: string,
  signature: string | null,
  env: NodeJS.ProcessEnv = process.env,
): StripeWebhookParseResult {
  const secret = (env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret) {
    if (isDeployedAppEnv(env)) {
      return { ok: false, error: 'Stripe webhook secret is not configured' };
    }
    try {
      const parsed = JSON.parse(payload) as Stripe.Event;
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'Invalid Stripe webhook payload' };
      }
      return { ok: true, event: parsed };
    } catch {
      return { ok: false, error: 'Invalid Stripe webhook payload' };
    }
  }

  if (!signature) {
    return { ok: false, error: 'Missing Stripe signature' };
  }

  try {
    const event = Stripe.webhooks.constructEvent(payload, signature, secret);
    return { ok: true, event };
  } catch {
    return { ok: false, error: 'Invalid Stripe signature' };
  }
}
