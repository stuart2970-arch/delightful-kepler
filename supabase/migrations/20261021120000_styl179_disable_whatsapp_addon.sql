-- STYL-179: Disable whatsapp_addon from public sale and log audit
-- Add-only, idempotent migration.

DO $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM public.addon_catalog WHERE id = 'whatsapp_addon';
  IF FOUND AND r.is_active IS DISTINCT FROM false THEN
    UPDATE public.addon_catalog
    SET is_active = false
    WHERE id = 'whatsapp_addon';

    INSERT INTO public.addon_audit_log (
      addon_catalog_id,
      action,
      old_value,
      new_value,
      summary
    ) VALUES (
      'whatsapp_addon',
      'addon_deactivated',
      row_to_json(r)::jsonb,
      jsonb_build_object('is_active', false),
      'STYL-179 disabled from public catalogue'
    );
  END IF;
END $$;
