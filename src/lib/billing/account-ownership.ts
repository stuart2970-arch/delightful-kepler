/**
 * What a salon owns, and the monthly total they actually pay.
 * A connected calendar is not an input: only a purchase row or an include switch counts.
 */

export const ONE_OFF_CATEGORIES = new Set(['voice_pack', 'sms_pack']);

export type CatalogAddon = {
  id: string;
  name: string;
  description?: string | null;
  category: string;
  monthly_price_pence: number;
  is_sliding?: boolean | null;
  is_active?: boolean | null;
  display_order?: number | null;
};

export type PurchaseRecord = {
  addon_catalog_id: string;
  is_active: boolean;
  price_paid_pence: number | null;
};

export type InclusionRecord = {
  addon_catalog_id: string;
  included: boolean;
  price_paid_pence: number;
};

export type PlanInput = {
  name: string;
  /** Null when the Foundation price cannot be read. */
  price_pence: number | null;
};

export type OwnershipSource = 'purchased' | 'included';

export type AccountProduct = {
  id: string;
  name: string;
  description: string;
  category: string;
  billing: 'monthly' | 'one_off';
  already_included: boolean;
  ownership: OwnershipSource | null;
  price_paid_pence: number | null;
  catalogue_price_pence: number;
  price_label: string;
};

export type IncludedFlag = {
  addon_catalog_id: string;
  included: boolean;
  price_paid_pence: number;
};

export type ActiveBoltOn = {
  addon_catalog_id: string;
  is_active: boolean;
  price_paid_pence: number | null;
};

export type AccountOwnership = {
  plan: {
    name: string;
    price_paid_pence: number | null;
  };
  monthly_total_pence: number | null;
  heading: string;
  monthly_bolt_ons: AccountProduct[];
  one_off_packs: AccountProduct[];
  included_flags: IncludedFlag[];
  active_bolt_ons: ActiveBoltOn[];
};

export function isOneOffCategory(category: string | null | undefined): boolean {
  return ONE_OFF_CATEGORIES.has(category || '');
}

export function formatPounds(pence: number): string {
  const safe = Number.isFinite(pence) ? pence : 0;
  return `£${(safe / 100).toFixed(2)}`;
}

/** Heading uses the short name from the signed-off example. */
export function planHeadingName(name: string | null | undefined): string {
  const trimmed = (name || '').trim();
  if (!trimmed || /foundation/i.test(trimmed) || trimmed === 'base_tier' || trimmed === 'basic') {
    return 'Foundation';
  }
  return trimmed;
}

/**
 * Pence charged for a bolt-on. A custom checkout price wins, then the Stripe
 * line amount, then the catalogue price.
 */
export function resolvePricePaidPence(options: {
  customPricePence?: number | null;
  stripeUnitAmount?: number | null;
  cataloguePricePence?: number | null;
}): number {
  const custom = options.customPricePence;
  if (custom != null && Number.isFinite(custom)) return Math.max(0, Math.round(custom));
  const stripeAmount = options.stripeUnitAmount;
  if (stripeAmount != null && Number.isFinite(stripeAmount)) return Math.max(0, Math.round(stripeAmount));
  const catalogue = options.cataloguePricePence;
  if (catalogue != null && Number.isFinite(catalogue)) return Math.max(0, Math.round(catalogue));
  return 0;
}

function priceLabel(product: {
  billing: 'monthly' | 'one_off';
  already_included: boolean;
  price_paid_pence: number | null;
  catalogue_price_pence: number;
  is_sliding: boolean;
}): string {
  const suffix = product.billing === 'monthly' ? '/mo' : '';
  if (product.already_included && product.price_paid_pence != null) {
    return `${formatPounds(product.price_paid_pence)}${suffix}`;
  }
  const prefix = product.is_sliding ? 'From ' : '';
  return `${prefix}${formatPounds(product.catalogue_price_pence)}${suffix}`;
}

function sellable(addon: CatalogAddon): boolean {
  return addon.is_active !== false && addon.id !== 'whatsapp_primary';
}

export function buildAccountOwnership(input: {
  plan: PlanInput;
  catalog: CatalogAddon[];
  purchases: PurchaseRecord[];
  inclusions: InclusionRecord[];
}): AccountOwnership {
  const planName = planHeadingName(input.plan.name);
  const purchases = input.purchases.filter((row) => row.addon_catalog_id);
  const inclusions = input.inclusions.filter((row) => row.addon_catalog_id);
  const catalog = [...input.catalog].filter(sellable).sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

  const products: AccountProduct[] = catalog.map((addon) => {
    const billing = isOneOffCategory(addon.category) ? 'one_off' : 'monthly';
    const purchase = purchases.find((row) => row.addon_catalog_id === addon.id && row.is_active);
    const inclusion = inclusions.find((row) => row.addon_catalog_id === addon.id && row.included);
    const alreadyIncluded = billing === 'monthly' && Boolean(purchase || inclusion);

    let ownership: OwnershipSource | null = null;
    let pricePaid: number | null = null;
    if (purchase) {
      ownership = 'purchased';
      pricePaid = purchase.price_paid_pence != null
        ? Math.max(0, Math.round(purchase.price_paid_pence))
        : Math.max(0, Math.round(addon.monthly_price_pence || 0));
    } else if (inclusion && billing === 'monthly') {
      ownership = 'included';
      pricePaid = Math.max(0, Math.round(inclusion.price_paid_pence || 0));
    }

    const cataloguePrice = Math.max(0, Math.round(addon.monthly_price_pence || 0));
    return {
      id: addon.id,
      name: addon.name,
      description: addon.description || '',
      category: addon.category,
      billing,
      already_included: alreadyIncluded,
      ownership: alreadyIncluded ? ownership : (billing === 'one_off' ? null : ownership),
      price_paid_pence: alreadyIncluded ? pricePaid : null,
      catalogue_price_pence: cataloguePrice,
      price_label: priceLabel({
        billing,
        already_included: alreadyIncluded,
        price_paid_pence: pricePaid,
        catalogue_price_pence: cataloguePrice,
        is_sliding: Boolean(addon.is_sliding),
      }),
    };
  });

  const monthly = products.filter((item) => item.billing === 'monthly');
  const oneOff = products.filter((item) => item.billing === 'one_off');
  const ownedMonthly = monthly.filter((item) => item.already_included);

  let monthlyTotal: number | null = null;
  let heading = `Current plan = ${planName}`;
  if (input.plan.price_pence == null || !Number.isFinite(input.plan.price_pence)) {
    heading = `${heading}. Price unavailable`;
  } else {
    const planPence = Math.max(0, Math.round(input.plan.price_pence));
    const boltOnPence = ownedMonthly.reduce((sum, item) => sum + (item.price_paid_pence || 0), 0);
    monthlyTotal = planPence + boltOnPence;
    const names = ownedMonthly.map((item) => item.name);
    const parts = [planName, ...names].join(' + ');
    heading = `Current plan = ${parts} = ${formatPounds(monthlyTotal)}`;
  }

  return {
    plan: {
      name: planName,
      price_paid_pence: input.plan.price_pence == null ? null : Math.max(0, Math.round(input.plan.price_pence)),
    },
    monthly_total_pence: monthlyTotal,
    heading,
    monthly_bolt_ons: monthly,
    one_off_packs: oneOff,
    included_flags: inclusions.map((row) => ({
      addon_catalog_id: row.addon_catalog_id,
      included: row.included,
      price_paid_pence: Math.max(0, Math.round(row.price_paid_pence || 0)),
    })),
    active_bolt_ons: purchases
      .filter((row) => {
        const addon = catalog.find((item) => item.id === row.addon_catalog_id);
        return addon ? !isOneOffCategory(addon.category) : true;
      })
      .map((row) => ({
        addon_catalog_id: row.addon_catalog_id,
        is_active: row.is_active,
        price_paid_pence: row.price_paid_pence,
      })),
  };
}
