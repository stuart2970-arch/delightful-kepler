import type Stripe from 'stripe';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildStripeCustomerInvoiceSettings,
  syncStripeCustomerInvoicePresentation,
} from './stripe-invoice-presentation';

export type StripeCustomerOps = Pick<
  Stripe['customers'],
  'create' | 'search' | 'list' | 'update'
>;

type CustomerLike = Pick<Stripe.Customer, 'id' | 'email' | 'metadata'>;

export function readCustomerMetadataTenantId(
  customer: Pick<Stripe.Customer, 'metadata'>,
): string | null {
  const raw = customer.metadata?.tenant_id;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed || null;
}

export function customerEmailMatches(customer: CustomerLike, email: string): boolean {
  return (customer.email || '').trim().toLowerCase() === email.trim().toLowerCase();
}

export function customerIsReusableForTenant(customer: CustomerLike, tenantId: string): boolean {
  const metaTenant = readCustomerMetadataTenantId(customer);
  if (!metaTenant) return true;
  return metaTenant === tenantId;
}

export function isStripeIdempotencyError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const stripeErr = err as { type?: string; code?: string; message?: string };
  if (stripeErr.type === 'idempotency_error') return true;
  if (stripeErr.code === 'idempotency_key_in_use') return true;
  const message = String(stripeErr.message || '');
  return /idempotency/i.test(message);
}

export async function findStripeCustomerIdByTenantMetadata(
  customers: StripeCustomerOps,
  tenantId: string,
): Promise<string | null> {
  const escaped = tenantId.replace(/'/g, "\\'");
  const result = await customers.search({
    query: `metadata['tenant_id']:'${escaped}'`,
    limit: 1,
  });
  return result.data[0]?.id ?? null;
}

export async function isStripeCustomerLinkedToOtherTenant(
  supabase: Pick<SupabaseClient, 'from'>,
  stripeCustomerId: string,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('tenants')
    .select('id')
    .eq('stripe_customer_id', stripeCustomerId)
    .neq('id', tenantId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to check Stripe customer tenant mapping');
  }
  return Boolean(data?.id);
}

export async function findReusableStripeCustomerByEmail(
  customers: StripeCustomerOps,
  supabase: Pick<SupabaseClient, 'from'>,
  tenantId: string,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  const listed = await customers.list({ email: normalized, limit: 10 });
  for (const customer of listed.data) {
    if (!customerEmailMatches(customer, normalized)) continue;
    if (!customerIsReusableForTenant(customer, tenantId)) continue;
    const linkedElsewhere = await isStripeCustomerLinkedToOtherTenant(
      supabase,
      customer.id,
      tenantId,
    );
    if (linkedElsewhere) continue;
    return customer.id;
  }
  return null;
}

export async function linkStripeCustomerToTenant(
  supabase: Pick<SupabaseClient, 'from'>,
  tenantId: string,
  stripeCustomerId: string,
): Promise<string> {
  const { data: linked, error } = await supabase
    .from('tenants')
    .update({ stripe_customer_id: stripeCustomerId })
    .eq('id', tenantId)
    .is('stripe_customer_id', null)
    .select('stripe_customer_id')
    .maybeSingle();

  if (error) {
    throw new Error(error.message || 'Failed to link Stripe customer to tenant');
  }
  if (linked?.stripe_customer_id) {
    return linked.stripe_customer_id;
  }

  const { data: row, error: readError } = await supabase
    .from('tenants')
    .select('stripe_customer_id')
    .eq('id', tenantId)
    .maybeSingle();

  if (readError) {
    throw new Error(readError.message || 'Failed to read tenant Stripe customer');
  }
  return row?.stripe_customer_id || stripeCustomerId;
}

async function ensureCustomerMetadataTenantId(
  customers: StripeCustomerOps,
  customerId: string,
  tenantId: string,
  knownCustomer?: CustomerLike,
): Promise<void> {
  const metaTenant = knownCustomer ? readCustomerMetadataTenantId(knownCustomer) : null;
  if (metaTenant) return;
  await customers.update(customerId, {
    metadata: { tenant_id: tenantId },
  });
}

async function createTenantStripeCustomer(
  stripe: Stripe,
  input: { tenantId: string; email: string },
  invoiceSettings: Stripe.CustomerCreateParams['invoice_settings'],
): Promise<string> {
  const createParams: Stripe.CustomerCreateParams = {
    email: input.email,
    metadata: { tenant_id: input.tenantId },
  };
  if (invoiceSettings) {
    createParams.invoice_settings = invoiceSettings;
  }

  try {
    const customer = await stripe.customers.create(createParams, {
      idempotencyKey: `cust-${input.tenantId}`,
    });
    return customer.id;
  } catch (err) {
    if (!isStripeIdempotencyError(err)) {
      throw err;
    }
    const existing = await findStripeCustomerIdByTenantMetadata(stripe.customers, input.tenantId);
    if (existing) return existing;
    throw err;
  }
}

/**
 * Guest/register GET checkout: reuse an existing Stripe customer by email only (no create).
 * Skips customers already tagged with metadata.tenant_id (tenant-owned billing profiles).
 */
export async function attachGuestSubscriptionCustomerByEmail(
  stripe: Stripe,
  sessionParams: Stripe.Checkout.SessionCreateParams,
  email?: string | null,
): Promise<void> {
  const normalized = (email || '').trim();
  if (!normalized) return;

  const listed = await stripe.customers.list({ email: normalized.toLowerCase(), limit: 10 });
  const match = listed.data.find(
    (customer) =>
      customerEmailMatches(customer, normalized) && !readCustomerMetadataTenantId(customer),
  );
  if (!match) return;

  await syncStripeCustomerInvoicePresentation(stripe, match.id);
  sessionParams.customer = match.id;
  delete sessionParams.customer_email;
}

/**
 * Tenant subscription checkout: resolve, link, and sync invoice presentation on the Customer.
 */
export async function ensureTenantStripeCustomerForSubscription(
  stripe: Stripe,
  supabase: Pick<SupabaseClient, 'from'>,
  input: {
    tenantId: string;
    stripeCustomerId?: string | null;
    email?: string | null;
  },
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  const invoiceSettings = buildStripeCustomerInvoiceSettings(env);
  let customerId = (input.stripeCustomerId || '').trim() || undefined;
  let matchedCustomer: CustomerLike | undefined;

  if (customerId) {
    await syncStripeCustomerInvoicePresentation(stripe, customerId, env);
    return customerId;
  }

  customerId =
    (await findStripeCustomerIdByTenantMetadata(stripe.customers, input.tenantId)) || undefined;

  const email = (input.email || '').trim();
  if (!customerId && email) {
    const reusableId = await findReusableStripeCustomerByEmail(
      stripe.customers,
      supabase,
      input.tenantId,
      email,
    );
    if (reusableId) {
      customerId = reusableId;
      const listed = await stripe.customers.list({ email: email.toLowerCase(), limit: 10 });
      matchedCustomer = listed.data.find((c) => c.id === reusableId);
    }
  }

  if (customerId) {
    const linkedElsewhere = await isStripeCustomerLinkedToOtherTenant(
      supabase,
      customerId,
      input.tenantId,
    );
    if (linkedElsewhere) {
      customerId = undefined;
      matchedCustomer = undefined;
    }
  }

  if (!customerId) {
    if (!email) return undefined;
    customerId = await createTenantStripeCustomer(
      stripe,
      { tenantId: input.tenantId, email },
      invoiceSettings ?? undefined,
    );
  } else {
    await syncStripeCustomerInvoicePresentation(stripe, customerId, env);
    await ensureCustomerMetadataTenantId(
      stripe.customers,
      customerId,
      input.tenantId,
      matchedCustomer,
    );
  }

  return linkStripeCustomerToTenant(supabase, input.tenantId, customerId);
}