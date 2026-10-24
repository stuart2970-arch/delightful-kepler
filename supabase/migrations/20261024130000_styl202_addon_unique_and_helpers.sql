-- =========================================================================
-- STYL-202 follow-up: tenant_active_addons uniqueness + helper hardening
-- Idempotent / live-safe.
--
-- 1. Deduplicate (tenant_id, addon_catalog_id) then add UNIQUE constraint
--    so seed.sql ON CONFLICT works when re-run via SQL alone.
-- 2. Pin search_path on public.set_tenant_id (trigger helper).
-- 3. Revoke EXECUTE from anon on get_auth_tenant_id / is_auth_admin
--    (RLS policies are TO authenticated only — verified in repo migrations).
-- 4. assert_staging_sql_reset_allowed() for SQL-editor staging reset guard.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Deduplicate then UNIQUE (tenant_id, addon_catalog_id)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables
    WHERE schemaname = 'public' AND tablename = 'tenant_active_addons'
  ) THEN
    RETURN;
  END IF;

  -- Keep the preferred row per (tenant_id, addon_catalog_id): active first, then newest.
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY tenant_id, addon_catalog_id
        ORDER BY
          COALESCE(is_active, false) DESC,
          COALESCE(created_at, '-infinity'::timestamptz) DESC,
          id
      ) AS rn
    FROM public.tenant_active_addons
    WHERE addon_catalog_id IS NOT NULL
  )
  DELETE FROM public.tenant_active_addons t
  USING ranked r
  WHERE t.id = r.id AND r.rn > 1;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tenant_active_addons_tenant_catalog_key'
      AND conrelid = 'public.tenant_active_addons'::regclass
  ) THEN
    ALTER TABLE public.tenant_active_addons
      ADD CONSTRAINT tenant_active_addons_tenant_catalog_key
      UNIQUE (tenant_id, addon_catalog_id);
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 2. Pin search_path on set_tenant_id
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_tenant_id'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    EXECUTE 'ALTER FUNCTION public.set_tenant_id() SET search_path = public';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 3. Revoke anon EXECUTE on RLS helpers; keep authenticated
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_auth_tenant_id'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.get_auth_tenant_id() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_auth_tenant_id() TO authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_auth_admin'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.is_auth_admin() FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_auth_admin() TO authenticated';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 4. Guard helper for SQL-only staging/local reset (no mutations)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.assert_staging_sql_reset_allowed()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  confirm text;
  migration_count integer := 0;
BEGIN
  confirm := coalesce(current_setting('app.confirm_staging_reset', true), '');
  IF confirm IS DISTINCT FROM 'styleflo-staging' AND confirm IS DISTINCT FROM 'local' THEN
    RAISE EXCEPTION
      'STYL-202: refusing SQL reset. In this session first run: SELECT set_config(''app.confirm_staging_reset'', ''styleflo-staging'', false); (or ''local''). Never against live (tkoasyjvrgaglofpzduq).';
  END IF;

  IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    EXECUTE 'SELECT count(*)::int FROM supabase_migrations.schema_migrations'
      INTO migration_count;
  END IF;

  -- Live historically tracks ~11 hand-applied versions; staging/local from the repo have 70+.
  IF migration_count < 50 THEN
    RAISE EXCEPTION
      'STYL-202: refusing SQL reset — only % recorded migrations (live tracks far fewer than the repo). This does not look like staging/local.',
      migration_count;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.assert_staging_sql_reset_allowed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_staging_sql_reset_allowed() TO postgres, service_role;
