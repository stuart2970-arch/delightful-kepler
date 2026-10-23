-- =========================================================================
-- STYL-194 / STYL-196
-- Store the price a salon actually pays for each active bolt-on, and add a
-- per-tenant include switch that a superadmin can turn on without a purchase.
--
-- This file is not applied to production by the pull request.
-- Stuart runs it separately, before the new billing page is deployed.
--
-- Backfill (only rows that already exist in tenant_active_addons):
-- 1. Copy addon_catalog.monthly_price_pence onto price_paid_pence.
-- 2. Where the latest addon_audit_log row for that salon and bolt-on recorded
--    a numeric custom_price_pence, replace the catalogue copy with that figure.
--    That is the grandfathered or sliding price already saved at checkout.
-- One-off pack rows are filled in too, but the monthly total ignores them.
-- No Stripe API calls. No tenant channel flags are changed.
-- =========================================================================

ALTER TABLE public.tenant_active_addons
    ADD COLUMN IF NOT EXISTS price_paid_pence INT;

DO $$
BEGIN
    ALTER TABLE public.tenant_active_addons
        ADD CONSTRAINT tenant_active_addons_price_paid_nonnegative
        CHECK (price_paid_pence IS NULL OR price_paid_pence >= 0);
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.tenant_active_addons.price_paid_pence IS
    'Pence this salon pays for the bolt-on. Null only before backfill. Not the live catalogue price.';

-- Step 1. Catalogue price for every active-addon row that has no price yet.
UPDATE public.tenant_active_addons AS taa
SET price_paid_pence = ac.monthly_price_pence
FROM public.addon_catalog AS ac
WHERE taa.addon_catalog_id = ac.id
  AND taa.price_paid_pence IS NULL;

-- Step 2. Prefer a custom price already written on the newest audit row.
UPDATE public.tenant_active_addons AS taa
SET price_paid_pence = audit.custom_price
FROM (
    SELECT DISTINCT ON (tenant_id, addon_catalog_id)
        tenant_id,
        addon_catalog_id,
        (new_value->>'custom_price_pence')::int AS custom_price
    FROM public.addon_audit_log
    WHERE tenant_id IS NOT NULL
      AND addon_catalog_id IS NOT NULL
      AND new_value ? 'custom_price_pence'
      AND (new_value->>'custom_price_pence') ~ '^[0-9]+$'
    ORDER BY tenant_id, addon_catalog_id, created_at DESC
) AS audit
WHERE taa.tenant_id = audit.tenant_id
  AND taa.addon_catalog_id = audit.addon_catalog_id
  AND audit.custom_price IS NOT NULL;

-- Superadmin include switch. A connected calendar is not a row in this table.
CREATE TABLE IF NOT EXISTS public.tenant_addon_inclusions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    addon_catalog_id TEXT NOT NULL REFERENCES public.addon_catalog(id),
    included BOOLEAN NOT NULL DEFAULT true,
    price_paid_pence INT NOT NULL DEFAULT 0 CHECK (price_paid_pence >= 0),
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, addon_catalog_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_addon_inclusions_tenant
    ON public.tenant_addon_inclusions (tenant_id);

ALTER TABLE public.tenant_addon_inclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_own_addon_inclusions ON public.tenant_addon_inclusions;
CREATE POLICY select_own_addon_inclusions ON public.tenant_addon_inclusions
    FOR SELECT TO authenticated
    USING (
        tenant_id IN (
            SELECT profiles.tenant_id
            FROM public.profiles
            WHERE profiles.id = auth.uid()
        )
    );
