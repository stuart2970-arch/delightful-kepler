-- STYL-226: one phone-number buy per tenant (reserve before Twilio) + orphan records.
-- Also store bolt-on subscription_status so paid landline/mobile is gated on active/trialing.

ALTER TABLE public.tenant_active_addons
  ADD COLUMN IF NOT EXISTS subscription_status TEXT;

-- Copy the tenant's known Stripe status onto add-ons. Do not blanket-set 'active'.
UPDATE public.tenant_active_addons AS taa
SET subscription_status = CASE
  WHEN lower(t.subscription_status) = 'canceled' THEN 'cancelled'
  WHEN lower(t.subscription_status) = 'unpaid' THEN 'past_due'
  ELSE lower(t.subscription_status)
END
FROM public.tenants AS t
WHERE taa.tenant_id = t.id
  AND taa.subscription_status IS NULL
  AND t.subscription_status IS NOT NULL
  AND btrim(t.subscription_status) <> '';

UPDATE public.tenant_active_addons
  SET subscription_status = 'cancelled'
  WHERE subscription_status IS NULL
    AND is_active IS NOT TRUE;

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
