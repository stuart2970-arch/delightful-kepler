import fs from 'fs';
import os from 'os';
import path from 'path';
import Stripe from 'stripe';

/**
 * Foundation is a Stripe subscription, not tenants.plan_tier or
 * tenants.subscription_status. Seeds and older rows default those columns to
 * foundation / active even when the salon has never paid.
 */

export const FOUNDATION_TIER_IDS = ['foundation', 'base_tier'] as const;

export const ACTIVE_FOUNDATION_SUBSCRIPTION_STATUSES = ['active', 'trialing', 'past_due'] as const;

const ACTIVE_STATUS = new Set<string>(ACTIVE_FOUNDATION_SUBSCRIPTION_STATUSES);

export type FoundationSubscriptionItem = {
  price?: { id?: string | null } | string | null;
  plan?: { id?: string | null } | null;
};

export type FoundationSubscriptionSummary = {
  status?: string | null;
  items?: { data?: FoundationSubscriptionItem[] } | null;
};

export type FoundationSubscriptionListClient = {
  list: (params: {
    customer: string;
    status: 'all';
    limit: number;
  }) => Promise<{ data?: FoundationSubscriptionSummary[] | null }>;
};

type TierPriceRow = {
  id?: string | null;
  stripe_price_id?: string | null;
};

type PlaywrightCustomerFixture = {
  error?: string;
  subscriptions?: FoundationSubscriptionSummary[];
};

export function playwrightFoundationSubscriptionFixturePath(): string {
  return path.join(os.tmpdir(), 'styleflo-playwright-foundation-subscriptions.json');
}

export function subscriptionItemPriceId(item: FoundationSubscriptionItem | null | undefined): string | null {
  if (!item) return null;
  const price = item.price;
  if (typeof price === 'string') {
    const trimmed = price.trim();
    return trimmed || null;
  }
  if (price && typeof price === 'object' && typeof price.id === 'string') {
    const trimmed = price.id.trim();
    if (trimmed) return trimmed;
  }
  const planId = item.plan && typeof item.plan.id === 'string' ? item.plan.id.trim() : '';
  return planId || null;
}

/**
 * True when a listed subscription is still billable and one of its items uses
 * a Foundation price id. Product names are ignored.
 */
export function subscriptionListHasActiveFoundation(
  subscriptions: readonly FoundationSubscriptionSummary[],
  foundationPriceIds: readonly string[],
): boolean {
  const prices = new Set(
    foundationPriceIds.map((id) => id.trim()).filter((id) => id.length > 0),
  );
  if (prices.size === 0) return false;

  return subscriptions.some((subscription) => {
    const status = (subscription.status || '').trim();
    if (!ACTIVE_STATUS.has(status)) return false;
    const items = subscription.items?.data || [];
    return items.some((item) => {
      const priceId = subscriptionItemPriceId(item);
      return Boolean(priceId && prices.has(priceId));
    });
  });
}

export async function listStripeCustomerSubscriptions(
  subscriptions: FoundationSubscriptionListClient,
  customerId: string,
): Promise<FoundationSubscriptionSummary[]> {
  const result = await subscriptions.list({
    customer: customerId,
    status: 'all',
    limit: 20,
  });
  return result.data || [];
}

export async function loadFoundationStripePriceIds(
  supabase: { from: (table: string) => any },
): Promise<string[]> {
  const { data, error } = await supabase
    .from('subscription_tiers')
    .select('id, stripe_price_id')
    .in('id', [...FOUNDATION_TIER_IDS]);

  if (error) {
    throw new Error(error.message || 'Could not read Foundation prices');
  }

  const ids = new Set<string>();
  for (const row of (data || []) as TierPriceRow[]) {
    const priceId = typeof row.stripe_price_id === 'string' ? row.stripe_price_id.trim() : '';
    if (priceId) ids.add(priceId);
  }
  return [...ids];
}

function readPlaywrightCustomerSubscriptions(customerId: string): FoundationSubscriptionSummary[] {
  const filePath = playwrightFoundationSubscriptionFixturePath();
  if (!fs.existsSync(filePath)) return [];
  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, PlaywrightCustomerFixture>;
  const entry = parsed[customerId];
  if (!entry) return [];
  if (typeof entry.error === 'string' && entry.error.trim()) {
    throw new Error(entry.error);
  }
  return Array.isArray(entry.subscriptions) ? entry.subscriptions : [];
}

/**
 * Playwright uses a fixture file instead of Stripe. Production always lists
 * the customer's subscriptions.
 */
export async function listSubscriptionsForFoundationCheck(
  stripe: { subscriptions: FoundationSubscriptionListClient } | null | undefined,
  customerId: string,
): Promise<FoundationSubscriptionSummary[]> {
  if (process.env.PLAYWRIGHT_TEST === 'true') {
    return readPlaywrightCustomerSubscriptions(customerId);
  }
  const client = stripe?.subscriptions ? stripe : createLiveStripe();
  if (!client) {
    throw new Error('Stripe is not configured');
  }
  return listStripeCustomerSubscriptions(client.subscriptions, customerId);
}

function createLiveStripe(): { subscriptions: FoundationSubscriptionListClient } | null {
  const apiKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  if (!apiKey) return null;
  return new Stripe(apiKey, {
    apiVersion: '2023-10-16' as any,
  }) as unknown as { subscriptions: FoundationSubscriptionListClient };
}

/**
 * null means the lookup failed. Callers hide Subscribe to Foundation and do
 * not treat the failure as "already subscribed".
 * false means there is no billable Foundation subscription (including no Stripe customer).
 */
export async function lookupHasActiveFoundationSubscription(options: {
  supabase: { from: (table: string) => any };
  stripeCustomerId: string | null | undefined;
  stripe?: { subscriptions: FoundationSubscriptionListClient } | null;
}): Promise<boolean | null> {
  const customerId = (options.stripeCustomerId || '').trim();
  if (!customerId) return false;

  try {
    const priceIds = await loadFoundationStripePriceIds(options.supabase);
    const subscriptions = await listSubscriptionsForFoundationCheck(options.stripe, customerId);
    return subscriptionListHasActiveFoundation(subscriptions, priceIds);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.error('[Billing] Foundation subscription lookup failed:', message);
    return null;
  }
}

export function writePlaywrightFoundationSubscriptionFixture(
  customers: Record<string, PlaywrightCustomerFixture>,
): void {
  if (process.env.PLAYWRIGHT_TEST !== 'true') {
    throw new Error('Foundation subscription fixtures are only written when PLAYWRIGHT_TEST=true');
  }
  const filePath = playwrightFoundationSubscriptionFixturePath();
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(customers));
  fs.renameSync(temporary, filePath);
}

export function clearPlaywrightFoundationSubscriptionFixture(): void {
  if (process.env.PLAYWRIGHT_TEST !== 'true') return;
  fs.rmSync(playwrightFoundationSubscriptionFixturePath(), { force: true });
}
