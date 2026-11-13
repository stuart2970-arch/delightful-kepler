-- =========================================================================
-- STYL-252: keep the WordPress tenant-created trigger, and close the
-- STYL-178 profile privilege gap left after 20261024120100 / 20261024120200.
--
-- Idempotent forward migration. Do not edit 20261024120100 or 20261024120200
-- (staging already records them as applied). Do not edit 20261024130000.
--
-- 1. WordPress sign-up pages
--    20261024120100 replaced sync_tenant_to_wordpress_fn with a no-op and
--    dropped trigger_sync_tenant_to_wordpress. Nothing in the app creates the
--    WordPress business page on sign-up (POST /api/tenants/publish-page is
--    manual). This restores the production behaviour from
--    20260809113000 / 20260816210000: AFTER INSERT on public.tenants, POST
--    { type, table, record } to the tenant-created webhook, and swallow
--    network errors so sign-up still commits.
--
--    The URL and bearer are NOT in this file. The function reads Supabase
--    Vault at call time:
--      tenant_created_webhook_url
--      tenant_created_webhook_secret          (must match TENANT_CREATED_WEBHOOK_SECRET)
--      tenant_created_webhook_environment     (required: exactly staging or production)
--    If the URL, the secret, or the environment row is missing, the trigger
--    does nothing. A NULL environment must not post.
--    Apply this file only after 20261024120200. That migration creates
--    protect_super_admin_flag(), which production does not have until then.
--    The POST target is the vault URL, and only these two exact pairs are sent:
--      environment = staging    AND url = https://staging.styleflo.ai/api/webhooks/tenant-created
--      environment = production AND url = https://app.styleflo.ai/api/webhooks/tenant-created
--    Any other environment value or any other URL (userinfo, trailing dot,
--    query string, http, a different host) does nothing.
--    Set the three vault secrets in the SQL editor per environment before
--    relying on sign-up page creation. See docs/staging.md.
--
-- 2. STYL-178
--    protect_super_admin_flag() is supplied by 20261024120200. Re-attach it
--    BEFORE INSERT OR UPDATE (UPDATE is the privilege-escalation path; INSERT
--    stays so a user cannot create a superadmin profile).
--    Revoke INSERT, UPDATE, and DELETE from PUBLIC, anon, and authenticated.
--    There is no column grant that lets authenticated change role. Sign-up
--    and invitations insert through handle_new_user(), which is SECURITY DEFINER.
--    A BEFORE UPDATE trigger blocks tenant_id changes unless auth.role() is
--    service_role (seed_mode still bypasses, same as 20261024120200).
--    update_profile and the restrictive policy stay in place. Without INSERT,
--    UPDATE, or DELETE grants they do not let anon or authenticated write.
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

CREATE SCHEMA IF NOT EXISTS private;

CREATE TABLE IF NOT EXISTS private.tenant_created_webhook_dispatch (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  url text NOT NULL,
  tenant_id uuid,
  request_id bigint
);

ALTER TABLE private.tenant_created_webhook_dispatch ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE private.tenant_created_webhook_dispatch FROM PUBLIC, anon, authenticated;

-- -------------------------------------------------------------------------
-- 1. Tenant-created webhook (production payload, per-environment target)
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_tenant_to_wordpress_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  webhook_url text;
  webhook_secret text;
  webhook_environment text;
  staging_url constant text := 'https://staging.styleflo.ai/api/webhooks/tenant-created';
  production_url constant text := 'https://app.styleflo.ai/api/webhooks/tenant-created';
  request_id bigint;
BEGIN
  BEGIN
    SELECT ds.decrypted_secret
      INTO webhook_url
    FROM vault.decrypted_secrets AS ds
    WHERE ds.name = 'tenant_created_webhook_url'
    ORDER BY ds.created_at DESC
    LIMIT 1;

    SELECT ds.decrypted_secret
      INTO webhook_secret
    FROM vault.decrypted_secrets AS ds
    WHERE ds.name = 'tenant_created_webhook_secret'
    ORDER BY ds.created_at DESC
    LIMIT 1;

    SELECT ds.decrypted_secret
      INTO webhook_environment
    FROM vault.decrypted_secrets AS ds
    WHERE ds.name = 'tenant_created_webhook_environment'
    ORDER BY ds.created_at DESC
    LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'tenant-created webhook skipped: vault config unreadable';
    RETURN NEW;
  END;

  webhook_url := pg_catalog.btrim(webhook_url);
  webhook_secret := pg_catalog.btrim(webhook_secret);
  webhook_environment := pg_catalog.btrim(webhook_environment);

  -- Exact allow-list only. A missing secret, a missing or NULL environment,
  -- or any URL that is not character-for-character the environment's endpoint
  -- does nothing. IS NOT TRUE treats the NULL comparison (no environment row)
  -- as a refusal. A plain IF NOT would skip that branch and still post.
  IF webhook_secret IS NULL OR webhook_secret = ''::text THEN
    RETURN NEW;
  END IF;

  IF (
    (webhook_environment = 'staging' AND webhook_url = staging_url)
    OR (webhook_environment = 'production' AND webhook_url = production_url)
  ) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  BEGIN
    request_id := net.http_post(
      url := webhook_url,
      headers := pg_catalog.jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || webhook_secret
      ),
      body := pg_catalog.jsonb_build_object(
        'type', 'INSERT',
        'table', 'tenants',
        'record', pg_catalog.row_to_json(NEW)
      )
    );

    INSERT INTO private.tenant_created_webhook_dispatch (url, tenant_id, request_id)
    VALUES (webhook_url, NEW.id, request_id);
  EXCEPTION WHEN OTHERS THEN
    -- Same as 20260816210000: a webhook failure must not roll back sign-up.
    RAISE WARNING 'WordPress sync webhook failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_tenant_to_wordpress_fn() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trigger_sync_tenant_to_wordpress ON public.tenants;
CREATE TRIGGER trigger_sync_tenant_to_wordpress
  AFTER INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_tenant_to_wordpress_fn();

-- -------------------------------------------------------------------------
-- 2. STYL-178: superadmin flag trigger supplied by 20261024120200
-- -------------------------------------------------------------------------
DROP TRIGGER IF EXISTS tr_protect_super_admin_flag ON public.profiles;
CREATE TRIGGER tr_protect_super_admin_flag
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_super_admin_flag();

-- Table UPDATE covers every column, so a column-only REVOKE would leave
-- has_column_privilege(..., 'UPDATE') true. authenticated and anon get no
-- INSERT, UPDATE, or DELETE. Sign-up and invitations insert through
-- handle_new_user() (SECURITY DEFINER). service_role keeps table UPDATE.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (is_super_admin, tenant_id, role) ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT UPDATE ON TABLE public.profiles TO service_role;

DROP POLICY IF EXISTS insert_profiles ON public.profiles;
DROP POLICY IF EXISTS delete_profiles ON public.profiles;
DROP POLICY IF EXISTS update_profiles ON public.profiles;

-- -------------------------------------------------------------------------
-- 3. tenant_id cannot move unless the caller is the service role
-- -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_tenant_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  seed_mode text;
  jwt_role text;
BEGIN
  seed_mode := pg_catalog.current_setting('app.seed_mode', true);
  IF seed_mode = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
    jwt_role := auth.role();
    IF jwt_role IS DISTINCT FROM 'service_role' THEN
      RAISE EXCEPTION 'Unauthorized: only service role can modify tenant_id'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_profile_tenant_id() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_protect_profile_tenant_id ON public.profiles;
CREATE TRIGGER tr_protect_profile_tenant_id
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_tenant_id();

-- -------------------------------------------------------------------------
-- 4. RLS WITH CHECK: own row cannot leave the caller's tenant or flip the flag
-- -------------------------------------------------------------------------
DROP POLICY IF EXISTS update_profile ON public.profiles;
CREATE POLICY update_profile ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin())
  )
  WITH CHECK (
    (
      id = auth.uid()
      OR (tenant_id = public.get_auth_tenant_id() AND public.is_auth_admin())
    )
    AND tenant_id IS NOT DISTINCT FROM public.get_auth_tenant_id()
    -- Compare against the caller's stored flag (auth.uid()), not the proposed row.
    AND is_super_admin IS NOT DISTINCT FROM (
      SELECT p.is_super_admin
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
    )
  );

DROP POLICY IF EXISTS profiles_lock_tenant_and_superadmin ON public.profiles;
CREATE POLICY profiles_lock_tenant_and_superadmin ON public.profiles
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (
    tenant_id IS NOT DISTINCT FROM public.get_auth_tenant_id()
    AND is_super_admin IS NOT DISTINCT FROM (
      SELECT p.is_super_admin
      FROM public.profiles AS p
      WHERE p.id = auth.uid()
    )
  );
