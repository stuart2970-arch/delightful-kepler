-- =========================================================================
-- STYL-385: Idempotent credit grants (invoice, checkout, one-off packs).
-- Local / staging only — never apply to live tkoasyjvrgaglofpzduq.
-- Apply after 20261101223000_grant_one_off_pack_atomic.sql and
-- 20261111143100_plan_voice_grant_idempotency.sql on production.
-- =========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS usage_ledger_invoice_addon_grant_key
  ON public.usage_ledger (tenant_id, sector_tag)
  WHERE usage_type = 'allocation'
    AND sector_tag LIKE 'invoice_addon:%';

CREATE UNIQUE INDEX IF NOT EXISTS usage_ledger_one_off_grant_key
  ON public.usage_ledger (tenant_id, sector_tag)
  WHERE usage_type = 'allocation'
    AND sector_tag LIKE 'one_off:%';

CREATE OR REPLACE FUNCTION public.grant_one_off_pack(
  p_tenant_id uuid,
  p_addon_catalog_id text,
  p_stripe_session_id text,
  p_audit_new_value jsonb,
  p_audit_summary text,
  p_credits jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_credit jsonb;
  v_feature_id text;
  v_quantity integer;
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := clock_timestamp() + interval '3 months';
  v_new_value jsonb;
  v_session text := coalesce(trim(p_stripe_session_id), '');
  v_sector text;
BEGIN
  IF p_tenant_id IS NULL OR coalesce(p_addon_catalog_id, '') = '' THEN
    RAISE EXCEPTION 'grant_one_off_pack requires tenant and catalogue';
  END IF;

  v_new_value := coalesce(p_audit_new_value, '{}'::jsonb);
  IF v_session <> '' THEN
    v_new_value := v_new_value || jsonb_build_object('stripe_session_id', v_session);
  END IF;

  INSERT INTO public.addon_audit_log (
    tenant_id,
    addon_catalog_id,
    action,
    new_value,
    summary
  ) VALUES (
    p_tenant_id,
    p_addon_catalog_id,
    'one_off_addon_purchased',
    v_new_value,
    p_audit_summary
  );

  FOR v_credit IN
    SELECT value FROM jsonb_array_elements(coalesce(p_credits, '[]'::jsonb))
  LOOP
    v_feature_id := v_credit->>'feature_id';
    v_quantity := coalesce((v_credit->>'quantity')::integer, 0);
    IF v_feature_id IS NULL OR v_feature_id = '' OR v_quantity <= 0 THEN
      CONTINUE;
    END IF;

    v_sector := CASE
      WHEN v_session <> '' THEN format('one_off:%s:%s', v_session, v_feature_id)
      ELSE NULL
    END;

    INSERT INTO public.usage_ledger (
      tenant_id,
      feature_id,
      quantity,
      usage_type,
      billing_period_start,
      expires_at,
      addon_catalog_id,
      sector_tag,
      recorded_at
    ) VALUES (
      p_tenant_id,
      v_feature_id,
      v_quantity,
      'allocation',
      v_now,
      v_expires,
      p_addon_catalog_id,
      v_sector,
      v_now
    );
  END LOOP;

  RETURN jsonb_build_object('granted', true, 'already_granted', false);
EXCEPTION
  WHEN unique_violation THEN
    IF SQLERRM ILIKE '%addon_audit_log_one_off_checkout_session_uidx%' THEN
      RETURN jsonb_build_object('granted', false, 'already_granted', true);
    END IF;
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_one_off_pack(uuid, text, text, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_one_off_pack(uuid, text, text, jsonb, text, jsonb)
  TO postgres, service_role;