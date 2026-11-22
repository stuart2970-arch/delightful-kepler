import type Stripe from 'stripe';

type InvoiceCustomField = NonNullable<
  NonNullable<Stripe.Checkout.SessionCreateParams['invoice_creation']>['invoice_data']
>['custom_fields'] extends (infer F)[] | undefined
  ? F
  : { name: string; value: string };

export type StripeInvoicePresentation = {
  footer: string;
  custom_fields: InvoiceCustomField[];
};

const DEFAULT_LEGAL_NAME = 'WP-123 T/A STYLEFLO LTD';
const DEFAULT_COMPANY_NUMBER = '17459342';
const DEFAULT_REGISTERED = 'Registered in England and Wales';
const DEFAULT_ADDRESS = 'Level One Basecamp Liverpool, 49 Jamaica St, Liverpool L1 0AH';
const DEFAULT_VAT_LINE = 'No VAT to add';

function envOrDefault(env: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = (env[key] || '').trim();
  return value || fallback;
}

export function buildStripeInvoicePresentation(env: NodeJS.ProcessEnv = process.env): StripeInvoicePresentation | null {
  if (env.STRIPE_INVOICE_PRESENTATION_ENABLED === 'false') {
    return null;
  }

  const legalName = envOrDefault(env, 'STRIPE_INVOICE_LEGAL_NAME', DEFAULT_LEGAL_NAME);
  const companyNumber = envOrDefault(env, 'STRIPE_INVOICE_COMPANY_NUMBER', DEFAULT_COMPANY_NUMBER);
  const registered = envOrDefault(env, 'STRIPE_INVOICE_REGISTERED', DEFAULT_REGISTERED);
  const address = envOrDefault(env, 'STRIPE_INVOICE_ADDRESS', DEFAULT_ADDRESS);
  const vatLine = envOrDefault(env, 'STRIPE_INVOICE_VAT_LINE', DEFAULT_VAT_LINE);

  const footer = [
    legalName,
    `Company no. ${companyNumber}`,
    registered,
    address,
    vatLine,
  ].join('\n');

  const custom_fields: InvoiceCustomField[] = [
    { name: 'Supplier', value: legalName },
    { name: 'Company number', value: companyNumber },
    { name: 'VAT', value: vatLine },
  ];

  return { footer, custom_fields };
}

export function applyStripeCheckoutInvoicePresentation(
  params: Stripe.Checkout.SessionCreateParams,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const presentation = buildStripeInvoicePresentation(env);
  if (!presentation) return;

  params.invoice_creation = {
    enabled: true,
    invoice_data: {
      footer: presentation.footer,
      custom_fields: presentation.custom_fields,
    },
  };
}