-- =========================================================================
-- One-off pack grants: allow the webhook audit action and make it
-- idempotent per Stripe checkout session (tenant + catalogue + session).
-- Staging / local Supabase only — never apply to live tkoasyjvrgaglofpzduq.
-- =========================================================================

DO $$
BEGIN
  IF to_regclass('public.addon_audit_log') IS NULL THEN
    RETURN;
  END IF;

  -- Webhook writes action = one_off_addon_purchased; the original CHECK omitted it.
  ALTER TABLE public.addon_audit_log DROP CONSTRAINT IF EXISTS addon_audit_log_action_check;
  ALTER TABLE public.addon_audit_log
    ADD CONSTRAINT addon_audit_log_action_check CHECK (action IN (
      'price_changed', 'addon_activated', 'addon_deactivated',
      'addon_created', 'addon_updated', 'tenant_migrated',
      'tier_deprecated', 'entitlement_overridden', 'base_tier_updated',
      'one_off_addon_purchased'
    ));

  -- Keep the first grant per checkout session, then unique-index the rest.
  WITH ranked AS (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY tenant_id, addon_catalog_id, (new_value->>'stripe_session_id')
        ORDER BY COALESCE(created_at, '-infinity'::timestamptz) ASC, id
      ) AS rn
    FROM public.addon_audit_log
    WHERE action = 'one_off_addon_purchased'
      AND COALESCE(new_value->>'stripe_session_id', '') <> ''
  )
  DELETE FROM public.addon_audit_log t
  USING ranked r
  WHERE t.id = r.id AND r.rn > 1;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS addon_audit_log_one_off_checkout_session_uidx
  ON public.addon_audit_log (tenant_id, addon_catalog_id, ((new_value->>'stripe_session_id')))
  WHERE action = 'one_off_addon_purchased'
    AND COALESCE(new_value->>'stripe_session_id', '') <> '';
