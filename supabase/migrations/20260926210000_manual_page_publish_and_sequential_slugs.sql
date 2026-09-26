-- Migration: Manual Business Page Creation & Unique Sequential Slugs for Registration (Google & Email)

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
  -- Look for pre-invited staff with a matching email
  SELECT * INTO matching_staff_record
  FROM public.staff
  WHERE email = NEW.email
  LIMIT 1;

  IF matching_staff_record.id IS NOT NULL THEN
    -- Scenario A: User was invited. Bind them to existing tenant
    INSERT INTO public.profiles (id, tenant_id, role, is_super_admin)
    VALUES (NEW.id, matching_staff_record.tenant_id, 'member', false);

    UPDATE public.staff
    SET user_id = NEW.id
    WHERE id = matching_staff_record.id;
  ELSE
    -- Scenario B: Normal / Google OAuth Registration. Provision new tenant with default placeholder
    company_name_input := COALESCE(NEW.raw_user_meta_data->>'company_name', 'My Workspace');
    base_slug := COALESCE(
      NEW.raw_user_meta_data->>'slug',
      trim(both '-' from regexp_replace(lower(company_name_input), '[^a-z0-9]+', '-', 'g'))
    );
    
    IF base_slug IS NULL OR base_slug = '' THEN
      base_slug := 'my-workspace';
    END IF;

    -- Guarantee Uniqueness with Sequential Numbering (e.g. my-workspace-1, my-workspace-2)
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

-- Disable automatic DB trigger on INSERT so business page creation is explicitly driven via UI button
DROP TRIGGER IF EXISTS trigger_sync_tenant_to_wordpress ON public.tenants;
