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

export async function findStripeCustomerIdByEmail(
  customers: StripeCustomerOps,
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;
  const listed = await customers.list({ email: normalized, limit: 3 });
  const match = listed.data.find((c) => (c.email || '').toLowerCase() === normalized);
  return match?.id ?? null;
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

/**
 * Guest/register GET checkout: reuse an existing Stripe customer by email only (no create).
 */
export async function attachGuestSubscriptionCustomerByEmail(
  stripe: Stripe,
  sessionParams: Stripe.Checkout.SessionCreateParams,
  email?: string | null,
): Promise<void> {
  const normalized = (email || '').trim();
  if (!normalized) return;

  const existingId = await findStripeCustomerIdByEmail(stripe.customers, normalized);
  if (!existingId) return;

  await syncStripeCustomerInvoicePresentation(stripe, existingId);
  sessionParams.customer = existingId;
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

  if (customerId) {
    await syncStripeCustomerInvoicePresentation(stripe, customerId, env);
    return customerId;
  }

  customerId =
    (await findStripeCustomerIdByTenantMetadata(stripe.customers, input.tenantId)) || undefined;

  const email = (input.email || '').trim();
  if (!customerId && email) {
    customerId = (await findStripeCustomerIdByEmail(stripe.customers, email)) || undefined;
  }

  if (!customerId) {
    if (!email) return undefined;

    const createParams: Stripe.CustomerCreateParams = {
      email,
      metadata: { tenant_id: input.tenantId },
    };
    if (invoiceSettings) {
      createParams.invoice_settings = invoiceSettings;
    }

    const customer = await stripe.customers.create(createParams, {
      idempotencyKey: `cust-${input.tenantId}`,
    });
    customerId = customer.id;
  } else {
    await syncStripeCustomerInvoicePresentation(stripe, customerId, env);
    await stripe.customers.update(customerId, {
      metadata: { tenant_id: input.tenantId },
    });
  }

  return linkStripeCustomerToTenant(supabase, input.tenantId, customerId);
}