-- =========================================================================
-- STYL-202: Enable RLS on entitlement tables (idempotent / live-safe)
--
-- After 20260722233000 DROP/CREATE, tier_entitlements lost its RLS policy
-- and the three tenant entitlement tables were never given RLS in repo
-- migrations. Live already has RLS enabled on all four (policies unknown).
--
-- App usage:
--   - Writes: service role only (superadmin APIs, Stripe webhook, entitlements lib)
--   - Reads:  authenticated tenants SELECT own active addons; all authenticated
--             SELECT tier_entitlements (catalogue); overrides/logs are
--             service-role or superadmin reads in practice
--
-- Service role bypasses RLS. Policies below are defence-in-depth for JWT clients.
-- Safe on live: ENABLE is a no-op when already on; DROP POLICY IF EXISTS then recreate.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. tier_entitlements (global catalogue — readable by any signed-in user)
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

-- -------------------------------------------------------------------------
-- 2. tenant_feature_overrides (tenant-scoped; service role writes)
-- -------------------------------------------------------------------------
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

-- -------------------------------------------------------------------------
-- 3. tenant_active_addons (dashboard SELECT under user JWT)
-- -------------------------------------------------------------------------
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

-- -------------------------------------------------------------------------
-- 4. entitlement_change_logs (audit — superadmin read; service role write)
-- -------------------------------------------------------------------------
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
