-- 1. Enable the pg_net extension to make async HTTP requests from Postgres
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 2. Create the custom trigger function to call our Next.js API route
CREATE OR REPLACE FUNCTION public.sync_tenant_to_wordpress_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://app.styleflo.ai/api/webhooks/tenant-created',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'tenants',
      'record', row_to_json(NEW)
    )::text
  );
  RETURN NEW;
END;
$$;

-- 3. Create the AFTER INSERT trigger on the public.tenants table
DROP TRIGGER IF EXISTS trigger_sync_tenant_to_wordpress ON public.tenants;
CREATE TRIGGER trigger_sync_tenant_to_wordpress
  AFTER INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_tenant_to_wordpress_fn();
