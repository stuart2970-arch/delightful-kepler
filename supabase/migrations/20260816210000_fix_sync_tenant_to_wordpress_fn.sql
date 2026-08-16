-- Fix sync_tenant_to_wordpress_fn function signature and exception handling
-- 1. Ensure body is passed as jsonb (not ::text) to match net.http_post signature
-- 2. Wrap http_post in EXCEPTION block so network/webhook errors never block tenant creation or user signups

CREATE OR REPLACE FUNCTION public.sync_tenant_to_wordpress_fn()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://app.styleflo.ai/api/webhooks/tenant-created'::text,
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'type', 'INSERT',
        'table', 'tenants',
        'record', row_to_json(NEW)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'WordPress sync webhook failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_sync_tenant_to_wordpress ON public.tenants;
CREATE TRIGGER trigger_sync_tenant_to_wordpress
  AFTER INSERT ON public.tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_tenant_to_wordpress_fn();
