-- STYL-364: Allow multiple active Extra Knowledge (data_pack_500) rows per tenant.

-- Drop full-row uniqueness so stacked purchases can coexist (inactive history included).
ALTER TABLE public.tenant_active_addons
  DROP CONSTRAINT IF EXISTS tenant_active_addons_tenant_catalog_key;

DROP INDEX IF EXISTS public.tenant_active_addons_one_active_per_catalog;

-- One active row per bolt-on, except stackable Extra Knowledge packs.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_active_addons_one_active_per_catalog
  ON public.tenant_active_addons (tenant_id, addon_catalog_id)
  WHERE is_active IS TRUE
    AND addon_catalog_id IS NOT NULL
    AND addon_catalog_id IS DISTINCT FROM 'data_pack_500';

CREATE OR REPLACE FUNCTION public.activate_tenant_addon(
  p_tenant_id uuid,
  p_addon_catalog_id text,
  p_feature_id text,
  p_subscription_status text,
  p_stripe_subscription_id text,
  p_stripe_subscription_item_id text,
  p_price_paid_pence integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_inserted boolean;
  v_repeatable boolean := (p_addon_catalog_id = 'data_pack_500');
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_addon_catalog_id, 0));

  IF v_repeatable AND p_stripe_subscription_item_id IS NOT NULL AND btrim(p_stripe_subscription_item_id) <> '' THEN
    SELECT id INTO v_id FROM tenant_active_addons
     WHERE tenant_id = p_tenant_id
       AND addon_catalog_id = p_addon_catalog_id
       AND is_active IS TRUE
       AND stripe_subscription_item_id = p_stripe_subscription_item_id
     ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE tenant_active_addons SET
        subscription_status = coalesce(nullif(p_subscription_status, ''), subscription_status, 'active'),
        stripe_subscription_id = coalesce(stripe_subscription_id, p_stripe_subscription_id),
        price_paid_pence = coalesce(p_price_paid_pence, price_paid_pence),
        feature_id = coalesce(p_feature_id, feature_id),
        deactivated_at = NULL
      WHERE id = v_id;
      RETURN jsonb_build_object('id', v_id, 'outcome', 'already_active');
    END IF;
  END IF;

  IF NOT v_repeatable THEN
    SELECT id INTO v_id FROM tenant_active_addons
     WHERE tenant_id = p_tenant_id AND addon_catalog_id = p_addon_catalog_id AND is_active IS TRUE
     ORDER BY created_at, id LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE tenant_active_addons SET
        subscription_status = coalesce(nullif(p_subscription_status, ''), subscription_status, 'active'),
        stripe_subscription_id = coalesce(stripe_subscription_id, p_stripe_subscription_id),
        stripe_subscription_item_id = coalesce(stripe_subscription_item_id, p_stripe_subscription_item_id),
        price_paid_pence = coalesce(p_price_paid_pence, price_paid_pence),
        feature_id = coalesce(p_feature_id, feature_id),
        deactivated_at = NULL
      WHERE id = v_id;
      RETURN jsonb_build_object('id', v_id, 'outcome', 'already_active');
    END IF;

    SELECT id INTO v_id FROM tenant_active_addons
     WHERE tenant_id = p_tenant_id AND addon_catalog_id = p_addon_catalog_id AND is_active IS NOT TRUE
     ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE;
    IF FOUND THEN
      UPDATE tenant_active_addons SET
        is_active = true, subscription_status = coalesce(nullif(p_subscription_status, ''), 'active'),
        activated_at = now(), deactivated_at = NULL,
        stripe_subscription_id = p_stripe_subscription_id,
        stripe_subscription_item_id = p_stripe_subscription_item_id,
        price_paid_pence = p_price_paid_pence, feature_id = p_feature_id
      WHERE id = v_id;
      RETURN jsonb_build_object('id', v_id, 'outcome', 'reactivated');
    END IF;
  END IF;

  INSERT INTO tenant_active_addons (tenant_id, addon_catalog_id, feature_id, quantity, is_active,
    subscription_status, activated_at, stripe_subscription_id, stripe_subscription_item_id, price_paid_pence)
  VALUES (p_tenant_id, p_addon_catalog_id, p_feature_id, 1, true,
    coalesce(nullif(p_subscription_status, ''), 'active'), now(),
    p_stripe_subscription_id, p_stripe_subscription_item_id, p_price_paid_pence)
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'outcome', 'inserted');
END;
$$;

REVOKE ALL ON FUNCTION public.activate_tenant_addon(uuid, text, text, text, text, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_tenant_addon(uuid, text, text, text, text, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.styl243_guard_active_addon_duplicates()
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  dup_count int;
  dup_detail text;
  mode text := coalesce(current_setting('app.styl243_dedupe', true), '');
BEGIN
  SELECT count(*), string_agg(tenant_id::text || '/' || addon_catalog_id || ' ids=' || ids, '; ')
    INTO dup_count, dup_detail
  FROM (
    SELECT tenant_id, addon_catalog_id, string_agg(id::text, ',' ORDER BY created_at, id) AS ids
    FROM public.tenant_active_addons
    WHERE is_active IS TRUE AND addon_catalog_id IS NOT NULL
      AND addon_catalog_id IS DISTINCT FROM 'data_pack_500'
    GROUP BY tenant_id, addon_catalog_id
    HAVING count(*) > 1
  ) d;

  IF dup_count > 0 AND mode IS DISTINCT FROM 'deactivate_newer' THEN
    RAISE EXCEPTION 'STYL-243: % active duplicate group(s) in tenant_active_addons: %. Nothing changed. Dedupe needs Stuart''s yes, then: SELECT set_config(''app.styl243_dedupe'',''deactivate_newer'',false);', dup_count, dup_detail;
  END IF;

  IF dup_count > 0 AND mode = 'deactivate_newer' THEN
    WITH ranked AS (
      SELECT id, row_number() OVER (PARTITION BY tenant_id, addon_catalog_id
                                    ORDER BY created_at, id) AS rn
      FROM public.tenant_active_addons
      WHERE is_active IS TRUE AND addon_catalog_id IS NOT NULL
        AND addon_catalog_id IS DISTINCT FROM 'data_pack_500'
    )
    UPDATE public.tenant_active_addons t
       SET is_active = false, subscription_status = 'cancelled', deactivated_at = now()
      FROM ranked r
     WHERE t.id = r.id AND r.rn > 1;
    RAISE NOTICE 'STYL-243: deactivated newer duplicates: %', dup_detail;
  END IF;
END;
$$;