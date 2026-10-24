-- =========================================================================
-- STYL-202: app.seed_mode GUC so seed.sql can skip signup provisioning
-- without ALTER TRIGGER on auth.users (seed role is not table owner).
-- Idempotent / live-safe: CREATE OR REPLACE only; no behaviour change unless
-- set_config('app.seed_mode','on',…) is used (local/staging seed only).
-- =========================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  matching_staff_record RECORD;
  new_tenant_id uuid;
  company_name_input text;
  base_slug text;
  final_slug text;
  counter integer := 1;
BEGIN
  -- Seed script sets app.seed_mode=on and inserts profiles/tenants itself.
  IF coalesce(current_setting('app.seed_mode', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO matching_staff_record
  FROM public.staff
  WHERE LOWER(TRIM(email)) = LOWER(TRIM(NEW.email))
  LIMIT 1;

  IF matching_staff_record.id IS NOT NULL THEN
    INSERT INTO public.profiles (id, tenant_id, role, is_super_admin)
    VALUES (NEW.id, matching_staff_record.tenant_id, 'member', false);

    UPDATE public.staff
    SET user_id = NEW.id
    WHERE id = matching_staff_record.id;
  ELSE
    company_name_input := COALESCE(NEW.raw_user_meta_data->>'company_name', 'My Workspace');
    base_slug := COALESCE(
      NEW.raw_user_meta_data->>'slug',
      trim(both '-' from regexp_replace(lower(company_name_input), '[^a-z0-9]+', '-', 'g'))
    );

    IF base_slug IS NULL OR base_slug = '' THEN
      base_slug := 'my-workspace';
    END IF;

    final_slug := base_slug;
    WHILE EXISTS (SELECT 1 FROM public.tenants WHERE slug = final_slug) LOOP
      final_slug := base_slug || '-' || counter;
      counter := counter + 1;
    END LOOP;

    INSERT INTO public.tenants (company_name, slug)
    VALUES (company_name_input, final_slug)
    RETURNING id INTO new_tenant_id;

    INSERT INTO public.profiles (id, tenant_id, role, is_super_admin)
    VALUES (NEW.id, new_tenant_id, 'owner', false);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_super_admin_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow seed.sql to create the fake superadmin profile.
  IF coalesce(current_setting('app.seed_mode', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin THEN
      IF auth.role() IS NULL OR auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized: only service role can modify is_super_admin flag';
      END IF;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.is_super_admin = true THEN
      IF auth.role() IS NULL OR auth.role() <> 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized: only service role can create a super admin profile';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_super_admin_flag() FROM PUBLIC, anon, authenticated;
