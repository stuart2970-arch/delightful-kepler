-- =========================================================================
-- STYL-242 / STYL-243: tenant_active_addons reads + one active bolt-on
--
-- Staging first (styleflo-staging / lriugykhrfnnouexqqhm).
-- Production (tkoasyjvrgaglofpzduq) only at promote, after the duplicate
-- check below passes or Stuart has opted in.
--
-- Supersedes supabase/migrations/20261024130000_styl202_addon_unique_and_helpers.sql
-- step 1 for production. That file DELETEs duplicate tenant_active_addons rows.
-- Never run 20261024130000 on live. This migration deactivates rows only, and
-- only when the session has set app.styl243_dedupe = 'deactivate_newer'.
--
-- Do not touch public.document_chunks_styl189_backup_20261105.
-- =========================================================================

-- -------------------------------------------------------------------------
-- Step 0. Refuse to continue while two active rows share a bolt-on.
-- The whole migration is one transaction: a refusal rolls back later steps.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.styl243_guard_active_addon_duplicates()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  dup_count int;
  dup_detail text;
  mode text := coalesce(current_setting('app.styl243_dedupe', true), '');
BEGIN
  SELECT count(*), string_agg(tenant_id::text || '/' || addon_catalog_id || ' ids=' || ids, '; ')
    INTO dup_count, dup_detail
  FROM (
    SELECT tenant_id, addon_catalog_id, string_agg(id::text, ',' ORDER BY created_at, id) AS ids
    FROM public.tenant_active_addons
    WHERE is_active IS TRUE AND addon_catalog_id IS NOT NULL
    GROUP BY tenant_id, addon_catalog_id
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 AND mode IS DISTINCT FROM 'deactivate_newer' THEN
    RAISE EXCEPTION 'STYL-243: % active duplicate group(s) in tenant_active_addons: %. Nothing changed. Dedupe needs Stuart''s yes, then: SELECT set_config(''app.styl243_dedupe'',''deactivate_newer'',false);', dup_count, dup_detail;
  END IF;

  IF dup_count > 0 AND mode = 'deactivate_newer' THEN
    WITH ranked AS (
      SELECT id, row_number() OVER (PARTITION BY tenant_id, addon_catalog_id
                                    ORDER BY created_at, id) AS rn
      FROM public.tenant_active_addons
      WHERE is_active IS TRUE AND addon_catalog_id IS NOT NULL
    )
    UPDATE public.tenant_active_addons t
       SET is_active = false, subscription_status = 'cancelled', deactivated_at = now()
      FROM ranked r
     WHERE t.id = r.id AND r.rn > 1;
    RAISE NOTICE 'STYL-243: deactivated newer duplicates: %', dup_detail;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.styl243_guard_active_addon_duplicates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.styl243_guard_active_addon_duplicates() TO service_role;

SELECT public.styl243_guard_active_addon_duplicates();

-- -------------------------------------------------------------------------
-- Step 1. SELECT-only policies. Same names and bodies as
-- 20261024120000_styl202_entitlement_tables_rls.sql so staging is a no-op
-- recreate. No INSERT/UPDATE/DELETE policies — writes stay service-role.
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'tier_entitlements'
  ) THEN
    ALTER TABLE public.tier_entitlements ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS select_entitlements ON public.tier_entitlements;
    DROP POLICY IF EXISTS select_tier_entitlements ON public.tier_entitlements;
    DROP POLICY IF EXISTS "select_tier_entitlements" ON public.tier_entitlements;

    CREATE POLICY select_tier_entitlements ON public.tier_entitlements
      FOR SELECT
      TO authenticated
      USING (true);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'tenant_feature_overrides'
  ) THEN
    ALTER TABLE public.tenant_feature_overrides ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS select_tenant_feature_overrides ON public.tenant_feature_overrides;
    DROP POLICY IF EXISTS select_own_tenant_feature_overrides ON public.tenant_feature_overrides;
    DROP POLICY IF EXISTS select_superadmin_tenant_feature_overrides ON public.tenant_feature_overrides;

    CREATE POLICY select_own_tenant_feature_overrides ON public.tenant_feature_overrides
      FOR SELECT
      TO authenticated
      USING (tenant_id = public.get_auth_tenant_id());

    CREATE POLICY select_superadmin_tenant_feature_overrides ON public.tenant_feature_overrides
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE profiles.id = auth.uid()
            AND profiles.is_super_admin = true
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'tenant_active_addons'
  ) THEN
    ALTER TABLE public.tenant_active_addons ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS select_tenant_active_addons ON public.tenant_active_addons;
    DROP POLICY IF EXISTS select_own_tenant_active_addons ON public.tenant_active_addons;
    DROP POLICY IF EXISTS select_superadmin_tenant_active_addons ON public.tenant_active_addons;

    CREATE POLICY select_own_tenant_active_addons ON public.tenant_active_addons
      FOR SELECT
      TO authenticated
      USING (tenant_id = public.get_auth_tenant_id());

    CREATE POLICY select_superadmin_tenant_active_addons ON public.tenant_active_addons
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE profiles.id = auth.uid()
            AND profiles.is_super_admin = true
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'entitlement_change_logs'
  ) THEN
    ALTER TABLE public.entitlement_change_logs ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS select_entitlement_change_logs ON public.entitlement_change_logs;
    DROP POLICY IF EXISTS select_own_entitlement_change_logs ON public.entitlement_change_logs;
    DROP POLICY IF EXISTS select_superadmin_entitlement_change_logs ON public.entitlement_change_logs;

    CREATE POLICY select_own_entitlement_change_logs ON public.entitlement_change_logs
      FOR SELECT
      TO authenticated
      USING (tenant_id = public.get_auth_tenant_id());

    CREATE POLICY select_superadmin_entitlement_change_logs ON public.entitlement_change_logs
      FOR SELECT
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM public.profiles
          WHERE profiles.id = auth.uid()
            AND profiles.is_super_admin = true
        )
      );
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- Step 2. One active row per tenant + catalogue. Inactive history stays.
-- Staging's full UNIQUE (tenant_id, addon_catalog_id) is left in place.
-- -------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS tenant_active_addons_one_active_per_catalog
  ON public.tenant_active_addons (tenant_id, addon_catalog_id)
  WHERE is_active IS TRUE AND addon_catalog_id IS NOT NULL;

-- -------------------------------------------------------------------------
-- Step 3. One locked activation. Service role only (RLS bypass via invoker).
-- Audit rows and rolling credits are the caller's job, and only when the
-- returned outcome is 'inserted' or 'reactivated'.
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.activate_tenant_addon(
  p_tenant_id uuid,
  p_addon_catalog_id text,
  p_feature_id text,
  p_subscription_status text,
  p_stripe_subscription_id text,
  p_stripe_subscription_item_id text,
  p_price_paid_pence integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_inserted boolean;
BEGIN
  -- Serialise concurrent webhook deliveries for the same tenant + bolt-on.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_addon_catalog_id, 0));

  -- 1. Already active: refresh, back-fill ids only where missing.
  SELECT id INTO v_id FROM tenant_active_addons
   WHERE tenant_id = p_tenant_id AND addon_catalog_id = p_addon_catalog_id AND is_active IS TRUE
   ORDER BY created_at, id LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE tenant_active_addons SET
      subscription_status = coalesce(nullif(p_subscription_status, ''), subscription_status, 'active'),
      stripe_subscription_id = coalesce(stripe_subscription_id, p_stripe_subscription_id),
      stripe_subscription_item_id = coalesce(stripe_subscription_item_id, p_stripe_subscription_item_id),
      price_paid_pence = coalesce(p_price_paid_pence, price_paid_pence),
      feature_id = coalesce(p_feature_id, feature_id),
      deactivated_at = NULL
    WHERE id = v_id;
    RETURN jsonb_build_object('id', v_id, 'outcome', 'already_active');
  END IF;

  -- 2. Reactivate the newest inactive row (keeps staging's full UNIQUE happy and avoids clutter).
  SELECT id INTO v_id FROM tenant_active_addons
   WHERE tenant_id = p_tenant_id AND addon_catalog_id = p_addon_catalog_id AND is_active IS NOT TRUE
   ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE;
  IF FOUND THEN
    UPDATE tenant_active_addons SET
      is_active = true, subscription_status = coalesce(nullif(p_subscription_status, ''), 'active'),
      activated_at = now(), deactivated_at = NULL,
      stripe_subscription_id = p_stripe_subscription_id,
      stripe_subscription_item_id = p_stripe_subscription_item_id,
      price_paid_pence = p_price_paid_pence, feature_id = p_feature_id
    WHERE id = v_id;
    RETURN jsonb_build_object('id', v_id, 'outcome', 'reactivated');
  END IF;

  -- 3. Fresh insert; the partial unique index is the backstop.
  INSERT INTO tenant_active_addons (tenant_id, addon_catalog_id, feature_id, quantity, is_active,
    subscription_status, activated_at, stripe_subscription_id, stripe_subscription_item_id, price_paid_pence)
  VALUES (p_tenant_id, p_addon_catalog_id, p_feature_id, 1, true,
    coalesce(nullif(p_subscription_status, ''), 'active'), now(),
    p_stripe_subscription_id, p_stripe_subscription_item_id, p_price_paid_pence)
  ON CONFLICT (tenant_id, addon_catalog_id) WHERE is_active IS TRUE AND addon_catalog_id IS NOT NULL
  DO UPDATE SET
    stripe_subscription_item_id = coalesce(tenant_active_addons.stripe_subscription_item_id, EXCLUDED.stripe_subscription_item_id),
    stripe_subscription_id = coalesce(tenant_active_addons.stripe_subscription_id, EXCLUDED.stripe_subscription_id)
  RETURNING id, (xmax = 0) INTO v_id, v_inserted;
  RETURN jsonb_build_object('id', v_id, 'outcome', CASE WHEN v_inserted THEN 'inserted' ELSE 'already_active' END);
END;
$$;

REVOKE ALL ON FUNCTION public.activate_tenant_addon(uuid, text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_tenant_addon(uuid, text, text, text, text, text, integer) TO service_role;
