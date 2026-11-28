import type Stripe from 'stripe';
import { ONE_OFF_CATEGORIES } from '@/lib/billing/account-ownership';

export type AddonCheckoutCatalogRow = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  monthly_price_pence?: number | null;
  is_sliding?: boolean | null;
  stripe_price_id?: string | null;
  stripe_product_id?: string | null;
};

export function usesFlatCatalogStripePrice(addon: AddonCheckoutCatalogRow): boolean {
  if (addon.is_sliding) return false;
  const category = addon.category || '';
  if (ONE_OFF_CATEGORIES.has(category)) return false;
  return true;
}

export function usesSlidingStripeProductPriceData(addon: AddonCheckoutCatalogRow): boolean {
  if (addon.is_sliding) return true;
  const category = addon.category || '';
  return ONE_OFF_CATEGORIES.has(category);
}

export function resolveFlatStripePriceId(addon: AddonCheckoutCatalogRow): string | null {
  const raw = addon.stripe_price_id;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveSlidingStripeProductId(addon: AddonCheckoutCatalogRow): string | null {
  const raw = addon.stripe_product_id;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export type BuildAddonLineItemInput = {
  addon: AddonCheckoutCatalogRow;
  unitAmountPence: number;
  description: string;
  recurring: boolean;
  metadata: Record<string, string>;
};

export type AddonLineItemBuildResult =
  | { ok: true; lineItem: Stripe.Checkout.SessionCreateParams.LineItem }
  | { ok: false; status: number; error: string };

export function buildAddonCheckoutLineItem(input: BuildAddonLineItemInput): AddonLineItemBuildResult {
  const { addon, unitAmountPence, description, recurring, metadata } = input;

  if (usesFlatCatalogStripePrice(addon)) {
    const priceId = resolveFlatStripePriceId(addon);
    if (!priceId) {
      return {
        ok: false,
        status: 503,
        error: `${addon.name || addon.id} is not configured for checkout yet (missing Stripe price). Please contact support.`,
      };
    }
    return {
      ok: true,
      lineItem: {
        price: priceId,
        quantity: 1,
      },
    };
  }

  if (!usesSlidingStripeProductPriceData(addon)) {
    return {
      ok: false,
      status: 503,
      error: `Checkout pricing is not configured for ${addon.name || addon.id}.`,
    };
  }

  const productId = resolveSlidingStripeProductId(addon);
  if (!productId) {
    return {
      ok: false,
      status: 503,
      error: `${addon.name || addon.id} is not configured for checkout yet (missing Stripe product). Please contact support.`,
    };
  }

  const priceData: Stripe.Checkout.SessionCreateParams.LineItem.PriceData = {
    currency: 'gbp',
    product: productId,
    unit_amount: unitAmountPence,
  };

  if (recurring) {
    priceData.recurring = { interval: 'month' };
  }

  return {
    ok: true,
    lineItem: {
      price_data: priceData,
      quantity: 1,
    },
  };
}

/** Ignore client custom price on flat catalogue items; only sliding add-ons honour it. */
export function shouldApplyCustomCheckoutPrice(
  addon: Pick<AddonCheckoutCatalogRow, 'is_sliding' | 'category'>,
  customPricePence: unknown,
): boolean {
  if (customPricePence === undefined || customPricePence === null || customPricePence === '') {
    return false;
  }
  return Boolean(addon.is_sliding) || ONE_OFF_CATEGORIES.has(addon.category || '');
}