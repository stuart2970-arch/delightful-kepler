-- STYL-261: guard out-of-order Stripe subscription.updated events for cancel state.
-- Additive; nullable. Rollback: DROP COLUMN IF EXISTS stripe_cancel_event_created_at.

ALTER TABLE public.tenant_active_addons
  ADD COLUMN IF NOT EXISTS stripe_cancel_event_created_at timestamptz;

COMMENT ON COLUMN public.tenant_active_addons.stripe_cancel_event_created_at IS
  'STYL-261: Unix event.created from the last Stripe subscription.updated applied to cancel_at / cancel_at_period_end.';