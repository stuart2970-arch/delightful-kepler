-- Fix handle_new_user to ensure tenant slug is preserved during signup
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
  slug_input text;
BEGIN
  -- Look for pre-invited staff with a matching email
  SELECT * INTO matching_staff_record
  FROM public.staff
  WHERE email = NEW.email
  LIMIT 1;

  IF matching_staff_record.id IS NOT NULL THEN
    -- Scenario A: User was invited. Bind them to the existing tenant as a 'member'
    INSERT INTO public.profiles (id, tenant_id, role, is_super_admin)
    VALUES (NEW.id, matching_staff_record.tenant_id, 'member', false);

    -- Update the staff profile to point to their Auth UID
    UPDATE public.staff
    SET user_id = NEW.id
    WHERE id = matching_staff_record.id;
  ELSE
    -- Scenario B: Normal registration. Provision new tenant and set as 'owner'
    company_name_input := COALESCE(NEW.raw_user_meta_data->>'company_name', 'My Workspace');
    slug_input := COALESCE(
      NEW.raw_user_meta_data->>'slug',
      trim(both '-' from regexp_replace(lower(company_name_input), '[^a-z0-9]+', '-', 'g'))
    );

    INSERT INTO public.tenants (company_name, slug)
    VALUES (company_name_input, slug_input)
    RETURNING id INTO new_tenant_id;

    INSERT INTO public.profiles (id, tenant_id, role, is_super_admin)
    VALUES (NEW.id, new_tenant_id, 'owner', false);
  END IF;

  RETURN NEW;
END;
$$;
