# Staging (STYL-202 / STYL-203)

Staging is a **second** Supabase project built only from this repo’s migrations and `supabase/seed.sql`. It must never hold live customer data.

The staging **app** runs on **Firebase App Hosting** (STYL-203) in Firebase project `styleflo-staging`. Supabase remains the database — Firebase is used for App Hosting only (no Firestore, Storage, RTDB, or Data Connect). Production stays on Cloud Run `styleflo-new` via `.github/workflows/deploy.yml`.

## Project details (no secrets)

| Field | Value |
| :--- | :--- |
| Name | `styleflo-staging` |
| Project ref | `lriugykhrfnnouexqqhm` |
| API URL | `https://lriugykhrfnnouexqqhm.supabase.co` |
| Region | `eu-west-1` |
| Plan | Free (£0/month) |
| Live ref (never use) | `tkoasyjvrgaglofpzduq` |
| Firebase project | `styleflo-staging` (Blaze) |
| App Hosting backend id | `delightful-kepler` |
| App Hosting region | `europe-west4` |
| Staging app URL | `https://delightful-kepler--styleflo-staging.europe-west4.hosted.app` |
| Live branch | `main` (automatic rollouts **OFF**) |

Do **not** commit anon, service_role, or database passwords. Staging server secrets live in **Google Cloud Secret Manager** for the Firebase project (see below). GitHub Environment **`staging`** may still hold copies for future CI workflows — never commit them.

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

1. **Site URL** — `https://delightful-kepler--styleflo-staging.europe-west4.hosted.app` (not `https://app.styleflo.ai`).
2. **Redirect URLs** — include that staging origin and local redirects used in QA (`http://localhost:3000/**` if needed). If you add custom domain `staging.app.styleflo.ai`, include it too.
3. **SMTP** — Mailgun **sandbox** or another mock provider. Never point staging auth mail at production Mailgun or real customer inboxes. Local CLI uses Inbucket instead (`http://127.0.0.1:54324`).

Optional: enable the Custom Access Token hook `public.custom_access_token_hook` if JWT tenant claims are required (same as live).

## Where staging secrets go

| Variable | Kind | Where |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | Plain value | `apphosting.staging.yaml` (staging API URL above) |
| `APP_ENV` / `NEXT_PUBLIC_ENV` | Plain value | `apphosting.staging.yaml` → `staging` |
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` | Plain value | `apphosting.staging.yaml` (App Hosting URL above) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Secret | Cloud Secret Manager → referenced as `secret:` in yaml |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Cloud Secret Manager only — never committed, never pasted into laptop `.env.local` pointed at live |
| Other server keys (Gemini, Stripe test, Mailgun sandbox, Twilio test, Vapi, Turnstile, OAuth, etc.) | Secret | Cloud Secret Manager — see list below |

Production Cloud Run continues to use production secrets. `deploy.yml` does **not** apply database migrations and is unchanged by STYL-203.

---

## Firebase App Hosting (STYL-203) — Stuart runbook

### Prerequisites (already done)

* Firebase project `styleflo-staging` on **Blaze**, budget alert from STYL-209.
* App Hosting backend **`delightful-kepler`**: region **europe-west4**, app root `/`, live branch `main`, **automatic rollouts OFF**, Environment name **`staging`** (so `apphosting.staging.yaml` is merged).
* Repo `apphosting.yaml` + `apphosting.staging.yaml` on `main` (this PR). Node **22** via `package.json` `engines.node`.

### 1. Create each Secret Manager secret

From a machine with Firebase CLI logged into the **styleflo-staging** Google account:

```bash
firebase use styleflo-staging

# Publishable / anon (still store as secrets — never commit values)
firebase apphosting:secrets:set NEXT_PUBLIC_SUPABASE_ANON_KEY
firebase apphosting:secrets:set NEXT_PUBLIC_VAPI_PUBLIC_KEY
firebase apphosting:secrets:set NEXT_PUBLIC_META_APP_ID
firebase apphosting:secrets:set NEXT_PUBLIC_META_ES_CONFIG_ID

# Core server secrets
firebase apphosting:secrets:set SUPABASE_SERVICE_ROLE_KEY
firebase apphosting:secrets:set GEMINI_API_KEY
firebase apphosting:secrets:set STRIPE_SECRET_KEY          # use sk_test_… only
firebase apphosting:secrets:set STRIPE_WEBHOOK_SECRET
firebase apphosting:secrets:set MAILGUN_API_KEY              # sandbox / mock
firebase apphosting:secrets:set MAILGUN_DOMAIN
firebase apphosting:secrets:set TWILIO_ACCOUNT_SID           # test account
firebase apphosting:secrets:set TWILIO_AUTH_TOKEN
firebase apphosting:secrets:set VAPI_API_KEY
firebase apphosting:secrets:set VAPI_MASTER_ASSISTANT_ID
firebase apphosting:secrets:set CLOUDFLARE_TURNSTILE_SECRET_KEY
firebase apphosting:secrets:set CHAT_SESSION_SIGNING_SECRET
firebase apphosting:secrets:set TOKEN_ENC_KEY
firebase apphosting:secrets:set CRON_SECRET
firebase apphosting:secrets:set OPENCLAW_BEARER_TOKEN
firebase apphosting:secrets:set GOOGLE_CLIENT_ID
firebase apphosting:secrets:set GOOGLE_CLIENT_SECRET
firebase apphosting:secrets:set MICROSOFT_CLIENT_ID
firebase apphosting:secrets:set MICROSOFT_CLIENT_SECRET
firebase apphosting:secrets:set META_ACCESS_TOKEN
firebase apphosting:secrets:set META_APP_SECRET
firebase apphosting:secrets:set META_VERIFY_TOKEN
firebase apphosting:secrets:set ELEVENLABS_API_KEY
firebase apphosting:secrets:set GOOGLE_PLACES_SERVER_API_KEY
firebase apphosting:secrets:set WPMUDEV_WEBHOOK_SECRET
firebase apphosting:secrets:set STYLEFLO_WP_API_SECRET
```

Each command prompts for the secret value (paste from the staging Supabase dashboard / vendor test consoles). Prefer **test / sandbox** vendor keys — never live production keys on staging.

### 2. Grant the App Hosting backend access

If `apphosting:secrets:set` did not already grant access (or secrets were created in Cloud Console / `gcloud`):

```bash
# Grant for each secret name created above, e.g.:
firebase apphosting:secrets:grantaccess SUPABASE_SERVICE_ROLE_KEY --backend delightful-kepler
firebase apphosting:secrets:grantaccess NEXT_PUBLIC_SUPABASE_ANON_KEY --backend delightful-kepler
firebase apphosting:secrets:grantaccess GEMINI_API_KEY --backend delightful-kepler
# …repeat for every secret listed in apphosting.staging.yaml
```

Alternatively, in Cloud Console → Secret Manager → each secret → Permissions → grant **Secret Manager Secret Accessor** to the App Hosting runtime service account (`firebase-app-hosting-compute@styleflo-staging.iam.gserviceaccount.com` / the project’s App Hosting compute SA).

### 3. Confirm Environment name is `staging`

Firebase console → App Hosting → backend `delightful-kepler` → Settings → Environment → Environment name = **`staging`**.  
That selects `apphosting.staging.yaml` over the base `apphosting.yaml`.

### 4. Trigger a manual rollout

Automatic rollouts are **OFF**. After secrets are set and this PR is on `main`:

* Console: App Hosting → `delightful-kepler` → **Roll out** / create rollout from `main`, **or**
* CLI: `firebase apphosting:rollouts:create delightful-kepler --git-branch main`

Watch the build log. The framework step runs `apphosting-adapter-nextjs-build` (which runs `npm run build` = Next build + `build:widget`). First failure on commit `f4b7f2a` was missing production `devDependencies` (`@tailwindcss/postcss`, `tailwindcss`, `esbuild`) — those are now in `dependencies`.

### 5. Smoke-check the staging URL

Open `https://delightful-kepler--styleflo-staging.europe-west4.hosted.app`:

* Visible **STAGING** banner and `X-Robots-Tag: noindex`.
* Page source / network must **not** contain live ref `tkoasyjvrgaglofpzduq`.
* `/widget.js` loads; `/api/chatbots/<id>` returns staging data.

### Env var inventory (code scan)

**Plain values in `apphosting.staging.yaml`:** `APP_ENV`, `NEXT_PUBLIC_ENV`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SITE_URL`, blank analytics IDs, `NEXT_PUBLIC_META_GRAPH_VERSION`.

**Secrets (Secret Manager names — create these):**  
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_VAPI_PUBLIC_KEY`, `NEXT_PUBLIC_META_APP_ID`, `NEXT_PUBLIC_META_ES_CONFIG_ID`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `VAPI_API_KEY`, `VAPI_MASTER_ASSISTANT_ID`, `CLOUDFLARE_TURNSTILE_SECRET_KEY`, `CHAT_SESSION_SIGNING_SECRET`, `TOKEN_ENC_KEY`, `CRON_SECRET`, `OPENCLAW_BEARER_TOKEN`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `META_ACCESS_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `ELEVENLABS_API_KEY`, `GOOGLE_PLACES_SERVER_API_KEY`, `WPMUDEV_WEBHOOK_SECRET`, `STYLEFLO_WP_API_SECRET`.

Aliases mapped to the same secret where the code accepts either name: `GOOGLE_GENERATIVE_AI_API_KEY` → `GEMINI_API_KEY`, `VAPI_PRIVATE_API_KEY` → `VAPI_API_KEY`, `SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

Optional later (referenced in code but not required for a first staging smoke): Twilio address/bundle SIDs, `OPENAI_API_KEY`, `STYLEFLO_WP_CREATE_BUSINESS_TOKEN`, `ADMIN_EMAIL` / `STYLEFLO_ADMIN_EMAIL`, Meta WhatsApp phone number id / token, `GCP_PROJECT_ID`.

### Fallback if App Hosting + Next.js 16 cannot work

If the adapter still cannot build or serve Next.js 16 after the dependency fix: stop and use **Firebase Hosting** with a rewrite to a **Cloud Run** service in the staging project (**europe-west2**), built from the existing `Dockerfile` (with required build-args, no live fallbacks). Do not implement that fallback in this ticket unless Next 16 is proven incompatible.

### CI guard

`npm run check:staging-no-live-ref` (also in the Playwright workflow) fails if `tkoasyjvrgaglofpzduq` appears in `apphosting.yaml`, `apphosting.staging.yaml`, or `Dockerfile`.

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
