import { test, expect } from '@playwright/test';
import { createTestUser, type TestUserSession } from './test-auth-helper';
import {
  buildStripeInvoicePresentation,
  applyStripeCheckoutInvoicePresentation,
} from '../src/lib/billing/stripe-invoice-presentation';

const SEEDED_TENANT_ID = '10000000-0000-0000-0000-000000000001';

test.describe('STYL-142 Stripe invoice presentation', () => {
  test('default company block includes STYLEFLO LTD and No VAT', () => {
    const presentation = buildStripeInvoicePresentation({} as NodeJS.ProcessEnv);
    expect(presentation).not.toBeNull();
    expect(presentation!.footer).toContain('WP-123 T/A STYLEFLO LTD');
    expect(presentation!.footer).toContain('17459342');
    expect(presentation!.footer).toContain('England and Wales');
    expect(presentation!.footer).toContain('Jamaica St');
    expect(presentation!.footer).toContain('No VAT to add');
    expect(presentation!.custom_fields.some((f) => f.name === 'VAT' && f.value === 'No VAT to add')).toBe(true);
  });

  test('environment overrides customise legal copy', () => {
    const presentation = buildStripeInvoicePresentation({
      STRIPE_INVOICE_LEGAL_NAME: 'Custom Legal',
      STRIPE_INVOICE_VAT_LINE: 'No VAT to add (test)',
    } as NodeJS.ProcessEnv);
    expect(presentation!.footer).toContain('Custom Legal');
    expect(presentation!.custom_fields.find((f) => f.name === 'VAT')?.value).toBe('No VAT to add (test)');
  });

  test('applyStripeCheckoutInvoicePresentation attaches invoice_creation', () => {
    const params: { invoice_creation?: { enabled: boolean; invoice_data: { footer: string } } } = {
      mode: 'subscription',
      line_items: [],
    };
    applyStripeCheckoutInvoicePresentation(params as never);
    expect(params.invoice_creation?.enabled).toBe(true);
    expect(params.invoice_creation?.invoice_data.footer).toContain('STYLEFLO LTD');
  });

  let ownerSession: TestUserSession;

  test.beforeAll(async () => {
    ownerSession = await createTestUser({ tenantId: SEEDED_TENANT_ID, role: 'owner' });
  });

  test.afterAll(async () => {
    if (ownerSession) await ownerSession.cleanup();
  });

  test('checkout mock response carries invoice_creation when PLAYWRIGHT_TEST uses sk_test_mock', async ({ request }) => {
    const res = await request.post('/api/billing/checkout', {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerSession.token}`,
      },
      data: {
        plan: 'foundation',
        planTier: 'base_tier',
      },
    });
    expect(res.status(), await res.text()).toBe(200);
    const json = await res.json();
    expect(json.invoice_creation?.enabled).toBe(true);
    expect(json.invoice_creation?.invoice_data?.footer).toContain('No VAT to add');
    expect(json.invoice_creation?.invoice_data?.custom_fields?.length).toBeGreaterThan(0);
  });
});