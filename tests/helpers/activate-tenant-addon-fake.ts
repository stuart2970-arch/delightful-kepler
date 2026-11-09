/**
 * In-memory stand-in for public.activate_tenant_addon.
 * Same outcomes as the migration: one active row, back-fill missing Stripe ids,
 * reactivate the newest inactive row, and serialise concurrent calls per pair.
 */

export type ActivateTenantAddonArgs = {
  p_tenant_id: string;
  p_addon_catalog_id: string;
  p_feature_id?: string | null;
  p_subscription_status?: string | null;
  p_stripe_subscription_id?: string | null;
  p_stripe_subscription_item_id?: string | null;
  p_price_paid_pence?: number | null;
};

type AddonRow = Record<string, any>;

function compareIds(a: AddonRow, b: AddonRow, direction: 1 | -1): number {
  const createdA = String(a.created_at || '');
  const createdB = String(b.created_at || '');
  if (createdA < createdB) return -1 * direction;
  if (createdA > createdB) return 1 * direction;
  const idA = String(a.id || '');
  const idB = String(b.id || '');
  if (idA < idB) return -1 * direction;
  if (idA > idB) return 1 * direction;
  return 0;
}

function statusOf(incoming: string | null | undefined, existing?: string | null): string {
  const trimmed = (incoming ?? '').trim();
  if (trimmed) return trimmed;
  return existing || 'active';
}

function applyOnce(rows: AddonRow[], args: ActivateTenantAddonArgs) {
  const same = rows.filter(
    (row) => row.tenant_id === args.p_tenant_id && row.addon_catalog_id === args.p_addon_catalog_id,
  );
  const active = same.filter((row) => row.is_active === true).sort((a, b) => compareIds(a, b, 1))[0];
  if (active) {
    active.subscription_status = statusOf(args.p_subscription_status, active.subscription_status);
    active.stripe_subscription_id = active.stripe_subscription_id || args.p_stripe_subscription_id || null;
    active.stripe_subscription_item_id = active.stripe_subscription_item_id || args.p_stripe_subscription_item_id || null;
    if (args.p_price_paid_pence != null) active.price_paid_pence = args.p_price_paid_pence;
    if (args.p_feature_id) active.feature_id = args.p_feature_id;
    active.deactivated_at = null;
    return { id: active.id, outcome: 'already_active' as const };
  }

  const inactive = same.filter((row) => row.is_active !== true).sort((a, b) => compareIds(a, b, -1))[0];
  if (inactive) {
    inactive.is_active = true;
    inactive.subscription_status = statusOf(args.p_subscription_status, null);
    inactive.activated_at = new Date().toISOString();
    inactive.deactivated_at = null;
    inactive.stripe_subscription_id = args.p_stripe_subscription_id ?? null;
    inactive.stripe_subscription_item_id = args.p_stripe_subscription_item_id ?? null;
    inactive.price_paid_pence = args.p_price_paid_pence ?? null;
    if (args.p_feature_id) inactive.feature_id = args.p_feature_id;
    return { id: inactive.id, outcome: 'reactivated' as const };
  }

  const id = crypto.randomUUID();
  rows.push({
    id,
    tenant_id: args.p_tenant_id,
    addon_catalog_id: args.p_addon_catalog_id,
    feature_id: args.p_feature_id ?? null,
    quantity: 1,
    is_active: true,
    subscription_status: statusOf(args.p_subscription_status, null),
    activated_at: new Date().toISOString(),
    deactivated_at: null,
    stripe_subscription_id: args.p_stripe_subscription_id ?? null,
    stripe_subscription_item_id: args.p_stripe_subscription_item_id ?? null,
    price_paid_pence: args.p_price_paid_pence ?? null,
    created_at: new Date().toISOString(),
  });
  return { id, outcome: 'inserted' as const };
}

export function createActivateTenantAddon(rows: AddonRow[]) {
  const tails = new Map<string, Promise<void>>();

  return async function activate(args: ActivateTenantAddonArgs) {
    const key = `${args.p_tenant_id}:${args.p_addon_catalog_id}`;
    const previous = tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    tails.set(key, previous.then(() => gate));
    await previous;
    try {
      return applyOnce(rows, args);
    } finally {
      release();
    }
  };
}
