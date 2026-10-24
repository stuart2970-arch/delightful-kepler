-- =========================================================================
-- STYL-202: SQL-only data reset for staging / local (NOT live)
-- =========================================================================
-- Use when the Supabase CLI is unavailable: run this in the staging project's
-- SQL editor (or any Postgres client), then run supabase/seed.sql in the same
-- session (or immediately after).
--
-- Holds / wipes no live customer data by design. Catalogue rows inserted by
-- migrations (tiers, features, addon_catalog, etc.) are preserved.
--
-- REQUIRED — set this in the SAME session before running the rest:
--
--   SELECT set_config('app.confirm_staging_reset', 'styleflo-staging', false);
--   -- or for local CLI DB:
--   SELECT set_config('app.confirm_staging_reset', 'local', false);
--
-- Then:
--   1) Run this file (reset_staging.sql)
--   2) Run supabase/seed.sql
--
-- The guard errors if the confirm GUC is missing/wrong, or if the database
-- has fewer than 50 recorded migrations (live historically tracks ~11).
-- Live project ref tkoasyjvrgaglofpzduq must never be the target.
-- =========================================================================

SELECT public.assert_staging_sql_reset_allowed();

-- Wipe tenant-scoped / operational data. CASCADE follows FKs into profiles,
-- chatbots, appointments, messages, tenant_active_addons, etc.
TRUNCATE TABLE public.tenants RESTART IDENTITY CASCADE;

-- Auth users are outside public.* cascade from tenants; clear for a clean reseed.
-- Seed inserts fixed UUIDs with ON CONFLICT.
DELETE FROM auth.identities;
DELETE FROM auth.users;

-- Optional staging noise (migration-seeded catalogues are NOT truncated)
TRUNCATE TABLE public.addon_audit_log RESTART IDENTITY CASCADE;
TRUNCATE TABLE public.entitlement_change_logs RESTART IDENTITY CASCADE;

SELECT set_config('app.confirm_staging_reset', '', false);

-- Next: run supabase/seed.sql (sets app.seed_mode and reloads fixtures).
SELECT 'STYL-202 reset complete. Now run supabase/seed.sql in this database.' AS next_step;
