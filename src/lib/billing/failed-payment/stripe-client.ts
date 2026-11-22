import Stripe from 'stripe';
import type { FailedPaymentStripeClient } from '@/lib/billing/failed-payment/stripe-types';

export type { FailedPaymentStripeClient } from '@/lib/billing/failed-payment/stripe-types';

export type FailedPaymentStripeGateway = {
  subscriptions: {
    update(id: string, params: Stripe.SubscriptionUpdateParams): Promise<unknown>;
    cancel(id: string, params?: Stripe.SubscriptionCancelParams): Promise<unknown>;
  };
  invoices: {
    markUncollectible(id: string): Promise<unknown>;
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

export function assertStripeTestModeKey(key: string): void {
  if (!/^(sk|rk)_test_/.test(key.trim())) {
    throw new Error('Failed-payment actions require a Stripe test-mode secret key');
  }
}

/** Pause collection so invoices raised while paused are voided and nothing is charged. */
export const FAILED_PAYMENT_PAUSE_PARAMS: Stripe.SubscriptionUpdateParams = {
  pause_collection: { behavior: 'void' },
};

/**
 * Clear the pause and start the next cycle from today.
 * The invoice that was just paid covers that first month. No proration charge.
 */
export const FAILED_PAYMENT_RESTART_PARAMS: Stripe.SubscriptionUpdateParams = {
  pause_collection: '',
  billing_cycle_anchor: 'now',
  proration_behavior: 'none',
};

export const FAILED_PAYMENT_CANCEL_PARAMS: Stripe.SubscriptionCancelParams = {
  invoice_now: false,
  prorate: false,
};

export function createFailedPaymentStripeClient(stripe: FailedPaymentStripeGateway): FailedPaymentStripeClient {
  return {
    async pauseCollection(subscriptionId: string) {
      await stripe.subscriptions.update(subscriptionId, FAILED_PAYMENT_PAUSE_PARAMS);
    },
    async restartBilling(subscriptionId: string) {
      await stripe.subscriptions.update(subscriptionId, FAILED_PAYMENT_RESTART_PARAMS);
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
  assertStripeTestModeKey(key);
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
