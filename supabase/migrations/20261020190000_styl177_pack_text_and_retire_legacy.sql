-- STYL-177: Retire legacy fixed packs and update customer-facing pack/bolt-on wording
-- Add-only, idempotent migration.

-- 1. Optional column for retired tracking
ALTER TABLE public.addon_catalog 
  ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ;

-- 2. Audit log helper & update logic
DO $$
DECLARE
  r RECORD;
BEGIN
  -- A. Retire legacy packs (voice_pack_50, voice_pack_100, sms_pack_500)
  FOR r IN 
    SELECT * FROM public.addon_catalog 
    WHERE id IN ('voice_pack_50', 'voice_pack_100', 'sms_pack_500')
  LOOP
    IF r.is_active = true THEN
      UPDATE public.addon_catalog 
      SET is_active = false, 
          retired_at = COALESCE(retired_at, now()) 
      WHERE id = r.id;

      INSERT INTO public.addon_audit_log (
        addon_catalog_id,
        action,
        old_value,
        new_value,
        summary
      ) VALUES (
        r.id,
        'addon_updated',
        row_to_json(r),
        jsonb_build_object('is_active', false, 'retired_at', now()),
        'STYL-177 legacy pack retired'
      );
    END IF;
  END LOOP;

  -- B. Update names and descriptions to generic wording without £ or hard-coded allowances
  -- 1) landline_addon
  SELECT * INTO r FROM public.addon_catalog WHERE id = 'landline_addon';
  IF FOUND THEN
    UPDATE public.addon_catalog
    SET name = 'Local Landline Number',
        description = 'A dedicated local landline number with a pool of shared voice minutes. The price depends on the area code and number type.'
    WHERE id = 'landline_addon';

    INSERT INTO public.addon_audit_log (
      addon_catalog_id, action, old_value, new_value, summary
    ) VALUES (
      'landline_addon',
      'addon_updated',
      row_to_json(r),
      jsonb_build_object('name', 'Local Landline Number', 'description', 'A dedicated local landline number with a pool of shared voice minutes. The price depends on the area code and number type.'),
      'STYL-177 wording update'
    );
  END IF;

  -- 2) mobile_addon
  SELECT * INTO r FROM public.addon_catalog WHERE id = 'mobile_addon';
  IF FOUND THEN
    UPDATE public.addon_catalog
    SET name = 'UK Mobile Number',
        description = 'A dedicated UK mobile number for SMS texts. The price depends on the number type.'
    WHERE id = 'mobile_addon';

    INSERT INTO public.addon_audit_log (
      addon_catalog_id, action, old_value, new_value, summary
    ) VALUES (
      'mobile_addon',
      'addon_updated',
      row_to_json(r),
      jsonb_build_object('name', 'UK Mobile Number', 'description', 'A dedicated UK mobile number for SMS texts. The price depends on the number type.'),
      'STYL-177 wording update'
    );
  END IF;

  -- 3) voice_pack_20
  SELECT * INTO r FROM public.addon_catalog WHERE id = 'voice_pack_20';
  IF FOUND THEN
    UPDATE public.addon_catalog
    SET name = 'Voice Minutes Pack',
        description = 'A one-off pack of extra shared voice minutes. Choose your pack size when you buy. Minutes expire 3 months after purchase.'
    WHERE id = 'voice_pack_20';

    INSERT INTO public.addon_audit_log (
      addon_catalog_id, action, old_value, new_value, summary
    ) VALUES (
      'voice_pack_20',
      'addon_updated',
      row_to_json(r),
      jsonb_build_object('name', 'Voice Minutes Pack', 'description', 'A one-off pack of extra shared voice minutes. Choose your pack size when you buy. Minutes expire 3 months after purchase.'),
      'STYL-177 wording update'
    );
  END IF;

  -- 4) sms_pack_100
  SELECT * INTO r FROM public.addon_catalog WHERE id = 'sms_pack_100';
  IF FOUND THEN
    UPDATE public.addon_catalog
    SET name = 'SMS Text Pack',
        description = 'A one-off pack of extra SMS texts. Choose your pack size when you buy. Texts expire 3 months after purchase and do not renew.'
    WHERE id = 'sms_pack_100';

    INSERT INTO public.addon_audit_log (
      addon_catalog_id, action, old_value, new_value, summary
    ) VALUES (
      'sms_pack_100',
      'addon_updated',
      row_to_json(r),
      jsonb_build_object('name', 'SMS Text Pack', 'description', 'A one-off pack of extra SMS texts. Choose your pack size when you buy. Texts expire 3 months after purchase and do not renew.'),
      'STYL-177 wording update'
    );
  END IF;

  -- 5) data_pack_500
  SELECT * INTO r FROM public.addon_catalog WHERE id = 'data_pack_500';
  IF FOUND THEN
    UPDATE public.addon_catalog
    SET name = 'Extra Knowledge',
        description = 'Extra knowledge items for your AI agent.'
    WHERE id = 'data_pack_500';

    INSERT INTO public.addon_audit_log (
      addon_catalog_id, action, old_value, new_value, summary
    ) VALUES (
      'data_pack_500',
      'addon_updated',
      row_to_json(r),
      jsonb_build_object('name', 'Extra Knowledge', 'description', 'Extra knowledge items for your AI agent.'),
      'STYL-177 wording update'
    );
  END IF;
END $$;
