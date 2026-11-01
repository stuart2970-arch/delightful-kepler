-- STYL-226: one phone-number buy per tenant (reserve before Twilio) + orphan records.
-- Also store bolt-on subscription_status so paid landline/mobile is gated on active/trialing.

ALTER TABLE public.tenant_active_addons
  ADD COLUMN IF NOT EXISTS subscription_status TEXT;

UPDATE public.tenant_active_addons
  SET subscription_status = 'active'
  WHERE is_active IS TRUE AND subscription_status IS NULL;

COMMENT ON COLUMN public.tenant_active_addons.subscription_status IS
  'Stripe/subscription state for the bolt-on. Paid phone buys require active or trialing.';

CREATE TABLE IF NOT EXISTS public.tenant_phone_number_purchases (
  tenant_id UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'orphan')),
  twilio_sid TEXT,
  phone_number TEXT,
  vapi_phone_id TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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
  'STYL-226: unique pending/active/orphan reservation so two requests cannot buy two Twilio numbers.';
