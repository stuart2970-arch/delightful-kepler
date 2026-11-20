-- A Foundation renewal grants the plan's voice minutes once per invoice.
-- Stripe retries the same invoice. The sector_tag is the idempotency key.
-- This does not change which allocations the 3-month balance counts.

CREATE UNIQUE INDEX IF NOT EXISTS usage_ledger_plan_voice_grant_key
  ON public.usage_ledger (tenant_id, sector_tag)
  WHERE usage_type = 'allocation' AND sector_tag LIKE 'plan_voice:%';
