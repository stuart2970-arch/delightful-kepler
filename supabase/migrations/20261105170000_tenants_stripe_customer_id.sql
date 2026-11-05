-- Billing portal and Stripe webhooks already read/write this column.
-- Without it, portal sessions always 409 no_billing_account.
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

COMMENT ON COLUMN public.tenants.stripe_customer_id IS
  'Stripe Customer id (cus_…) for this workspace. Null until Checkout or a webhook links one.';
