import { test, expect } from '@playwright/test';
import Stripe from 'stripe';
import {
  applyStripeCheckoutInvoicePresentation,
  buildStripeCustomerInvoiceSettings,
  buildStripeInvoicePresentation,
} from '../../src/lib/billing/stripe-invoice-presentation';

test.describe('STYL-142 checkout invoice params builder', () => {
  test('payment mode enables invoice_creation with company footer', () => {
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'payment',
      line_items: [],
    };
    applyStripeCheckoutInvoicePresentation(params);
    expect(params.invoice_creation?.enabled).toBe(true);
    expect(params.invoice_creation?.invoice_data?.footer).toContain('No VAT to add');
    expect(params.invoice_creation?.invoice_data?.custom_fields?.length).toBeGreaterThan(0);
  });

  test('subscription mode does not set invoice_creation', () => {
    const params: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      line_items: [],
      subscription_data: { metadata: { plan_tier: 'base_tier' } },
    };
    applyStripeCheckoutInvoicePresentation(params);
    expect(params.invoice_creation).toBeUndefined();
  });

  test('subscription invoices use customer invoice_settings shape', () => {
    const settings = buildStripeCustomerInvoiceSettings();
    expect(settings?.footer).toContain('STYLEFLO LTD');
    expect(settings?.custom_fields?.some((f) => f.name === 'VAT')).toBe(true);
    expect(buildStripeInvoicePresentation()).not.toBeNull();
  });
});

test.describe('STYL-142 Stripe test-mode smoke', () => {
  const apiKey = (process.env.STRIPE_SECRET_KEY || '').trim();
  const isStripeTestKey = /^sk_test_/.test(apiKey) && apiKey !== 'sk_test_mock';

  test.skip(!isStripeTestKey, 'Requires a real Stripe test secret (not sk_test_mock)');

  test('Stripe test API accepts customer invoice_settings footer and custom fields', async () => {
    const settings = buildStripeCustomerInvoiceSettings();
    expect(settings).not.toBeNull();

    const stripe = new Stripe(apiKey, { apiVersion: '2023-10-16' as never });
    const customer = await stripe.customers.create({
      email: `styl-142-${Date.now()}@styleflo.invalid`,
      invoice_settings: settings!,
    });

    expect(customer.invoice_settings?.footer).toContain('No VAT to add');
    expect(customer.invoice_settings?.custom_fields?.length).toBeGreaterThan(0);

    await stripe.customers.del(customer.id);
  });
});