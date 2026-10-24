# Staging Supabase (STYL-202)

Staging is a **second** Supabase project built only from this repo’s migrations and `supabase/seed.sql`. It must never hold live customer data.

## Project details (no secrets)

| Field | Value |
| :--- | :--- |
| Name | `styleflo-staging` |
| Project ref | `lriugykhrfnnouexqqhm` |
| API URL | `https://lriugykhrfnnouexqqhm.supabase.co` |
| Region | `eu-west-1` |
| Plan | Free (£0/month) |
| Live ref (never use) | `tkoasyjvrgaglofpzduq` |

Do **not** commit anon, service_role, or database passwords. Put staging secrets in the GitHub **`staging`** environment only.

## Reset (one command — CLI)

Local CLI stack (default):

```bash
npx supabase start          # if not already running
npm run db:reset            # migrations + seed; refuses live ref
npm run env:local           # refresh .env.local / .env.test from local status
```

Linked remote (staging project only — after `supabase link` to staging):

```bash
npm run db:reset -- --linked
```

Explicit Postgres URL (must not contain the live ref):

```bash
npm run db:reset -- --db-url "$STAGING_DB_URL"
```

The script hard-refuses project ref `tkoasyjvrgaglofpzduq`. Seed data is synthetic only (see the header comment in `supabase/seed.sql`).

## Reset (SQL editor — no CLI)

When you only have the Supabase SQL editor / a Postgres connector against **staging**:

1. In the **same session**, confirm the target (required guard):

   ```sql
   SELECT set_config('app.confirm_staging_reset', 'styleflo-staging', false);
   -- local CLI DB instead: set_config(..., 'local', false);
   ```

2. Run [`supabase/reset_staging.sql`](../supabase/reset_staging.sql) — truncates tenant/auth fixtures; preserves migration catalogue tables. The guard raises if the confirm GUC is wrong or the DB has fewer than 50 recorded migrations (live historically tracks ~11).

3. Run [`supabase/seed.sql`](../supabase/seed.sql) in the same database. Seed is idempotent for re-runs via SQL alone (including `tenant_active_addons` via `ON CONFLICT (tenant_id, addon_catalog_id)`).

Never point these scripts at live (`tkoasyjvrgaglofpzduq`).

## Free-plan 7-day inactivity pause

Free projects pause after about **seven days** without activity. Options:

1. **Lightweight keep-alive** — workflow `.github/workflows/staging-keepalive.yml` runs on a weekly schedule and issues a cheap HTTPS request to the staging API URL (not live). Enable the workflow’s schedule when staging secrets/URL are ready.
2. **Manual resume** — in the Supabase dashboard, open `styleflo-staging` and use **Restore** / resume if paused, then re-run `npm run db:reset -- --linked` if the schema was wiped.

## Auth settings Stuart must set (dashboard)

In Supabase → Authentication for `styleflo-staging`:

1. **Site URL** — staging app URL (e.g. Cloud Run staging host), not `https://app.styleflo.ai`.
2. **Redirect URLs** — include the staging origin(s) and local redirects used in QA (`http://localhost:3000/**` if needed).
3. **SMTP** — Mailgun **sandbox** or another mock provider. Never point staging auth mail at production Mailgun or real customer inboxes. Local CLI uses Inbucket instead (`http://127.0.0.1:54324`).

Optional: enable the Custom Access Token hook `public.custom_access_token_hook` if JWT tenant claims are required (same as live).

## Where the service_role key goes

| Secret | Where |
| :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | GitHub Environment **`staging`** (value: staging API URL above) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | GitHub Environment **`staging`** |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Environment **`staging`** only — never `.env.local` on a laptop pointed at live, never committed |

Production Cloud Run continues to use production secrets. `deploy.yml` does **not** apply database migrations.

## Aligning migration versions (`supabase migration repair`)

Staging was first built by applying every file under `supabase/migrations/` (70 files at main `d196328`). Version rows may use **today’s timestamps** in `supabase_migrations.schema_migrations` while **names** still match the repo files.

If the CLI complains that remote history diverges from local files:

```bash
# Inspect
npx supabase migration list --linked

# Mark a version as applied or reverted without re-running SQL
npx supabase migration repair --status applied <version>
npx supabase migration repair --status reverted <version>
```

Use repair only to align **bookkeeping**. Prefer applying new forward migrations (e.g. STYL-202 RLS/hardening) with `npm run db:reset -- --linked` on staging, or `supabase db push` after link — never against live from a developer machine.

## Deploy vs migrations

`.github/workflows/deploy.yml` (push to `main`) builds and deploys Cloud Run only. It does **not** run `supabase db push` or otherwise migrate live or staging. Schema changes ship as SQL files and are applied deliberately (local/CI reset, or an operator against staging).

## Seed mode (`app.seed_mode`)

`supabase/seed.sql` sets `app.seed_mode=on` while inserting fixtures so `handle_new_user` and `protect_super_admin_flag` skip signup provisioning / superadmin protection. The seed role is not the owner of `auth.users`, so disabling that trigger is not possible. Normal signups are unchanged when the GUC is unset or `off`.

`tenant_active_addons` has a unique constraint on `(tenant_id, addon_catalog_id)` so re-running seed does not duplicate the Acme `google_calendar_addon` row.

## Empty historical migration

`20260712182829_add_chatbot_to_services_staff.sql` is intentionally empty; the real `chatbot_id` columns are added in `20260712183000_add_chatbot_id_to_services_staff.sql`. Do not edit the empty file (checksum already recorded on staging).

## Live schema drift (do not fix live here)

Live has tables that no repo migration creates. Capturing them later would need new migrations such as:

1. **`referral_clicks`** — used by `src/app/api/track/route.ts` (`chatbot_id`, `source_host`, plus typical `id` / `created_at`). Tracked under STYL-197 / STYL-207.
2. **`knowledge_sources`** — referenced on live only; app knowledge path uses `document_chunks`. Confirm live columns before writing a migration (STYL-197 / STYL-207).

Live also appears to track far fewer applied migration versions than the repo (hand-applied drift). Do not “repair” live from this workstream without an explicit STYL-197/207 plan.
