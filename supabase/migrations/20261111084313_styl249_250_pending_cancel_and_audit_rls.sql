-- STYL-249 / STYL-250: pending bolt-on cancellation columns and addon_audit_log RLS.
-- Staging first; production only at promote.
-- Additive and idempotent; no deletes or data rewrites.
-- Does not depend on 20261024130000, 20261024120100, or 20261024120200.
-- Does not create knowledge_sources or referral_clicks, and does not add JWT policies on them.

-- STYL-249: pending-cancel columns. Nullable; existing rows stay NULL (= not pending).
ALTER TABLE public.tenant_active_addons
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean,
  ADD COLUMN IF NOT EXISTS cancel_at timestamptz;

COMMENT ON COLUMN public.tenant_active_addons.cancel_at_period_end IS
  'STYL-249: Stripe cancel_at_period_end. Entitlement stays on until customer.subscription.deleted.';
COMMENT ON COLUMN public.tenant_active_addons.cancel_at IS
  'STYL-249: Stripe cancel_at (timestamptz). Display in Europe/London as Cancels [date].';

-- Webhook writes addon_cancel_scheduled / addon_cancel_unscheduled.
-- addon_audit_log_action_check (20261101210000) would reject those actions.
-- Superset of the previous list; no row rewrite.
DO $$
BEGIN
  IF to_regclass('public.addon_audit_log') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.addon_audit_log DROP CONSTRAINT IF EXISTS addon_audit_log_action_check;
  ALTER TABLE public.addon_audit_log
    ADD CONSTRAINT addon_audit_log_action_check CHECK (action IN (
      'price_changed', 'addon_activated', 'addon_deactivated',
      'addon_created', 'addon_updated', 'tenant_migrated',
      'tier_deprecated', 'entitlement_overridden', 'base_tier_updated',
      'one_off_addon_purchased',
      'addon_cancel_scheduled', 'addon_cancel_unscheduled'
    ));
END $$;

-- STYL-250: replace the cross-tenant SELECT.
ALTER TABLE public.addon_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS select_addon_audit_log ON public.addon_audit_log;
DROP POLICY IF EXISTS select_own_addon_audit_log ON public.addon_audit_log;
DROP POLICY IF EXISTS select_superadmin_addon_audit_log ON public.addon_audit_log;

CREATE POLICY select_own_addon_audit_log ON public.addon_audit_log
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_auth_tenant_id());

CREATE POLICY select_superadmin_addon_audit_log ON public.addon_audit_log
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid() AND profiles.is_super_admin = true
  ));

-- knowledge_sources / referral_clicks: production-only tables, RLS already on, no JWT callers.
-- Do not CREATE POLICY. Leaving zero policies keeps JWT fail-closed; service_role still bypasses RLS.
-- Staging does not have these tables — guard so the file is a no-op there.
DO $$
BEGIN
  IF to_regclass('public.knowledge_sources') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.knowledge_sources ENABLE ROW LEVEL SECURITY';
  END IF;
  IF to_regclass('public.referral_clicks') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.referral_clicks ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;
