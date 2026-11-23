import Stripe from 'stripe';
import type { FailedPaymentStripeClient } from '@/lib/billing/failed-payment/stripe-types';

export type { FailedPaymentStripeClient } from '@/lib/billing/failed-payment/stripe-types';

export type FailedPaymentBillingInterval = 'day' | 'week' | 'month' | 'year';

export type FailedPaymentSubscriptionSnapshot = {
  items?: {
    data?: Array<{
      price?: { recurring?: { interval?: string | null; interval_count?: number | null } | null } | null;
      plan?: { interval?: string | null; interval_count?: number | null } | null;
    }>;
  };
};

export type FailedPaymentStripeGateway = {
  subscriptions: {
    retrieve(id: string): Promise<FailedPaymentSubscriptionSnapshot>;
    update(id: string, params: Stripe.SubscriptionUpdateParams): Promise<unknown>;
    cancel(id: string, params?: Stripe.SubscriptionCancelParams): Promise<unknown>;
  };
  invoices: {
    markUncollectible(id: string): Promise<unknown>;
    create?(params?: unknown): Promise<unknown>;
  };
};

type StripeErrorLike = {
  code?: string;
  message?: string;
  raw?: { code?: string; message?: string };
};

function errorParts(error: unknown): { code: string; message: string } {
  const row = (error ?? {}) as StripeErrorLike;
  return {
    code: String(row.code || row.raw?.code || ''),
    message: String(row.message || row.raw?.message || ''),
  };
}

export function isInvoiceAlreadyWrittenOff(error: unknown): boolean {
  const { code, message } = errorParts(error);
  if (code === 'invoice_already_uncollectible') return true;
  return /already uncollectible|status is void|status is uncollectible|can no longer be paid|invoice is void/i.test(message);
}

export function isSubscriptionAlreadyCancelled(error: unknown): boolean {
  const { code, message } = errorParts(error);
  if (code === 'resource_missing') return true;
  return /already canceled|already cancelled|a canceled subscription/i.test(message);
}

export function assertStripeKeyForFailedPayment(key: string, env: NodeJS.ProcessEnv = process.env): void {
  const trimmed = key.trim();
  if (!/^(sk|rk)_(test|live)_/.test(trimmed)) {
    throw new Error('Failed-payment actions require a Stripe secret key');
  }
  if ((env.PLAYWRIGHT_TEST || '').trim() === 'true' && !/^(sk|rk)_test_/.test(trimmed)) {
    throw new Error('Failed-payment actions require a Stripe test-mode secret key');
  }
}

/** Pause collection so invoices raised while paused are voided and nothing is charged. */
export const FAILED_PAYMENT_PAUSE_PARAMS: Stripe.SubscriptionUpdateParams = {
  pause_collection: { behavior: 'void' },
};

/**
 * Clear the pause and give the paid invoice one billing interval.
 * trial_end becomes the next anchor. Stripe does not invoice today.
 */
export function failedPaymentRestartParams(trialEndUnix: number): Stripe.SubscriptionUpdateParams {
  return {
    pause_collection: '',
    trial_end: trialEndUnix,
    proration_behavior: 'none',
  };
}

export function addBillingInterval(
  from: Date,
  interval: FailedPaymentBillingInterval,
  intervalCount: number,
): Date {
  const count = Number.isFinite(intervalCount) && intervalCount > 0 ? Math.floor(intervalCount) : 1;
  const next = new Date(from.getTime());
  if (interval === 'day') next.setUTCDate(next.getUTCDate() + count);
  else if (interval === 'week') next.setUTCDate(next.getUTCDate() + (count * 7));
  else if (interval === 'year') next.setUTCFullYear(next.getUTCFullYear() + count);
  else next.setUTCMonth(next.getUTCMonth() + count);
  return next;
}

function billingIntervalFromSubscription(
  subscription: FailedPaymentSubscriptionSnapshot,
): { interval: FailedPaymentBillingInterval; intervalCount: number } {
  const item = subscription.items?.data?.[0];
  const recurring = item?.price?.recurring;
  const rawInterval = recurring?.interval || item?.plan?.interval || '';
  const rawCount = recurring?.interval_count ?? item?.plan?.interval_count ?? 1;
  if (rawInterval !== 'day' && rawInterval !== 'week' && rawInterval !== 'month' && rawInterval !== 'year') {
    throw new Error('Failed payment restart needs a recurring billing interval');
  }
  return { interval: rawInterval, intervalCount: rawCount || 1 };
}

export const FAILED_PAYMENT_CANCEL_PARAMS: Stripe.SubscriptionCancelParams = {
  invoice_now: false,
  prorate: false,
};

export function createFailedPaymentStripeClient(stripe: FailedPaymentStripeGateway): FailedPaymentStripeClient {
  return {
    async pauseCollection(subscriptionId: string) {
      await stripe.subscriptions.update(subscriptionId, FAILED_PAYMENT_PAUSE_PARAMS);
    },
    async restartBilling(subscriptionId: string, restartedAt: Date) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const { interval, intervalCount } = billingIntervalFromSubscription(subscription);
      const nextBillingAt = addBillingInterval(restartedAt, interval, intervalCount);
      const trialEndUnix = Math.floor(nextBillingAt.getTime() / 1000);
      await stripe.subscriptions.update(subscriptionId, failedPaymentRestartParams(trialEndUnix));
      return { nextBillingAt: new Date(trialEndUnix * 1000).toISOString() };
    },
    async cancelSubscription(subscriptionId: string) {
      try {
        await stripe.subscriptions.cancel(subscriptionId, FAILED_PAYMENT_CANCEL_PARAMS);
      } catch (error) {
        if (!isSubscriptionAlreadyCancelled(error)) throw error;
      }
    },
    async writeOffInvoice(invoiceId: string) {
      try {
        await stripe.invoices.markUncollectible(invoiceId);
      } catch (error) {
        if (!isInvoiceAlreadyWrittenOff(error)) throw error;
      }
    },
  };
}

export function createFailedPaymentStripeClientFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): FailedPaymentStripeClient {
  const key = (env.STRIPE_SECRET_KEY || '').trim();
  assertStripeKeyForFailedPayment(key, env);
  const stripe = new Stripe(key, {
    apiVersion: '2023-10-16' as Stripe.LatestApiVersion,
  });
  return createFailedPaymentStripeClient(stripe);
}

let testClient: FailedPaymentStripeClient | null = null;

/** Test double. Ignored unless PLAYWRIGHT_TEST=true. */
export function setFailedPaymentStripeClientForTests(client: FailedPaymentStripeClient | null): void {
  if ((process.env.PLAYWRIGHT_TEST || '').trim() !== 'true') {
    throw new Error('Failed-payment test Stripe client is unavailable');
  }
  testClient = client;
}

export function resolveFailedPaymentStripeClient(): FailedPaymentStripeClient {
  if ((process.env.PLAYWRIGHT_TEST || '').trim() === 'true' && testClient) {
    return testClient;
  }
  return createFailedPaymentStripeClientFromEnv();
}
