-- STYL-226: one phone-number buy per tenant (reserve before Twilio) + orphan records.
-- Also store bolt-on subscription_status so paid landline/mobile is gated on active/trialing.
-- Do not copy tenants.subscription_status (it defaults to 'active' and would unlock unpaid bolt-ons).
-- Leave subscription_status NULL so the paid gate blocks until Stripe writes the add-on's own status.

ALTER TABLE public.tenant_active_addons
  ADD COLUMN IF NOT EXISTS subscription_status TEXT;

ALTER TABLE public.tenant_active_addons
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

COMMENT ON COLUMN public.tenant_active_addons.subscription_status IS
  'Stripe/subscription state for this bolt-on subscription. Paid phone buys require active or trialing. NULL means unknown/unpaid and must not pass the gate.';

COMMENT ON COLUMN public.tenant_active_addons.stripe_subscription_id IS
  'Stripe Subscription id (sub_...) for this bolt-on. Invoice success/failure updates only the matching row.';

CREATE TABLE IF NOT EXISTS public.tenant_phone_number_purchases (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'orphan', 'unknown')),
  twilio_sid TEXT,
  phone_number TEXT,
  vapi_phone_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_phone_number_purchases_status_check'
      AND conrelid = 'public.tenant_phone_number_purchases'::regclass
  ) THEN
    ALTER TABLE public.tenant_phone_number_purchases
      DROP CONSTRAINT tenant_phone_number_purchases_status_check;
  END IF;
  ALTER TABLE public.tenant_phone_number_purchases
    ADD CONSTRAINT tenant_phone_number_purchases_status_check
    CHECK (status IN ('pending', 'active', 'orphan', 'unknown'));
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS tenant_phone_number_purchases_tenant_uidx
  ON public.tenant_phone_number_purchases (tenant_id);

ALTER TABLE public.tenant_phone_number_purchases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_own_tenant_phone_number_purchases ON public.tenant_phone_number_purchases;
CREATE POLICY select_own_tenant_phone_number_purchases
  ON public.tenant_phone_number_purchases
  FOR SELECT
  TO authenticated
  USING (
    tenant_id IN (
      SELECT p.tenant_id FROM public.profiles p WHERE p.id = auth.uid()
    )
  );

COMMENT ON TABLE public.tenant_phone_number_purchases IS
  'STYL-226: unique pending/active/orphan/unknown reservation so two requests cannot buy two Twilio numbers.';
