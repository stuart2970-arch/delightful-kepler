-- Update the slug for existing tenants
UPDATE public.tenants
SET slug = trim(both '-' from regexp_replace(lower(company_name), '[^a-z0-9]+', '-', 'g'))
WHERE slug IS NULL AND company_name IS NOT NULL;
