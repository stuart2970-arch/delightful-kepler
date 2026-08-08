-- Update the signup trigger function to handle the tenant slug
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  new_tenant_id uuid;
  company_name_input text;
  slug_input text;
BEGIN
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

  RETURN NEW;
END;
$$;

-- Run a backfill update to populate the slug column for any existing tenants that currently have no slug
UPDATE public.tenants
SET slug = trim(both '-' from regexp_replace(lower(company_name), '[^a-z0-9]+', '-', 'g'))
WHERE slug IS NULL OR slug = '';
