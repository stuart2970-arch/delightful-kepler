-- =========================================================================
-- STYL-202: SECURITY DEFINER hardening (idempotent / live-safe)
--
-- 1. Pin search_path on SECURITY DEFINER functions that lacked it
-- 2. Revoke EXECUTE from anon/authenticated on functions clients never call
--    via PostgREST (.rpc). Keep get_auth_tenant_id / is_auth_admin — used in RLS.
-- 3. Neutralise unused sync_tenant_to_wordpress_fn (hard-coded live URL;
--    trigger already dropped in 20260926210000)
--
-- App RPC usage (all via supabaseAdmin / service role):
--   match_documents, check_email_exists, sync_tenant_channel_flags,
--   purge_expired_whatsapp_messages
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1. Pin search_path (ALTER is idempotent)
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'custom_access_token_hook'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.custom_access_token_hook(jsonb) SET search_path = public';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'sync_tenant_channel_flags'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.sync_tenant_channel_flags(uuid) SET search_path = public';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'protect_super_admin_flag'
  ) THEN
    EXECUTE 'ALTER FUNCTION public.protect_super_admin_flag() SET search_path = public';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 2. Revoke client EXECUTE on trigger-only / service-role-only functions
-- -------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
      AND pg_get_function_identity_arguments(p.oid) = ''
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'match_documents'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.match_documents(vector, float, integer, uuid, uuid) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.match_documents(vector, float, integer, uuid, uuid) TO service_role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'check_email_exists'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.check_email_exists(text) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.check_email_exists(text) TO service_role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'sync_tenant_channel_flags'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.sync_tenant_channel_flags(uuid) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.sync_tenant_channel_flags(uuid) TO service_role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'purge_expired_whatsapp_messages'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.purge_expired_whatsapp_messages() FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.purge_expired_whatsapp_messages() TO service_role';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'protect_super_admin_flag'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.protect_super_admin_flag() FROM PUBLIC, anon, authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'sync_tenant_to_wordpress_fn'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.sync_tenant_to_wordpress_fn() FROM PUBLIC, anon, authenticated';
  END IF;

  -- custom_access_token_hook already revoked in jwt_auth_hook; re-assert
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'custom_access_token_hook'
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin';
  END IF;
END $$;

-- Keep RLS helpers callable by authenticated (policy expressions invoke them)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_auth_tenant_id'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_auth_tenant_id() TO authenticated';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_auth_admin'
  ) THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.is_auth_admin() TO authenticated';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 3. Neutralise WordPress sync function (no live URL; trigger already gone)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_tenant_to_wordpress_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Trigger dropped in 20260926210000. Kept as a no-op so older environments
  -- that still reference the function name do not POST to production.
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_tenant_to_wordpress_fn() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trigger_sync_tenant_to_wordpress ON public.tenants;
