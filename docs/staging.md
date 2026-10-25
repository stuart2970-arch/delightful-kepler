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
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_URL` | Plain value | **`apphosting.yaml`** (base — BUILD + RUNTIME; staging-only Firebase project) |
| `APP_ENV` / `NEXT_PUBLIC_ENV` | Plain value | **`apphosting.yaml`** → `staging` (also re-asserted in `apphosting.staging.yaml`) |
| `NEXT_PUBLIC_APP_URL` / `NEXT_PUBLIC_SITE_URL` | Plain value | **`apphosting.yaml`** (App Hosting URL above) |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Plain value | **`apphosting.yaml`** — Cloudflare always-pass site key (see Turnstile note below) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Secret Manager | Base + staging yaml — **BUILD + RUNTIME** (must be grantaccess’d) |
| **Six core secrets** | Secret Manager | Listed in the runbook below — referenced in `apphosting.staging.yaml` (anon also in base) |
| Feature secrets (Stripe, Twilio, …) | Optional later | See **Feature secrets to add later** — not required for build/boot |

Plain `NEXT_PUBLIC_*` values live in **base** `apphosting.yaml` so App Hosting BUILD still sees them even if the backend Environment name is unset (that caused the `/login` prerender failure on build `f287d45b`). This Firebase project hosts staging only; production Cloud Run via `deploy.yml` does **not** read `apphosting.yaml`.

Production Cloud Run continues to use production secrets. `deploy.yml` typechecks on **Node 22** (aligned with `package.json` engines); deploy behaviour is otherwise unchanged. `deploy.yml` does **not** apply database migrations.

---

## Firebase App Hosting (STYL-203) — Stuart runbook

### Prerequisites (already done)

* Firebase project `styleflo-staging` on **Blaze**, budget alert from STYL-209.
* App Hosting backend **`delightful-kepler`**: region **europe-west4**, app root `/`, live branch `main`, **automatic rollouts OFF**.
* **Required:** Environment name **`staging`** (Settings → Environment) so `apphosting.staging.yaml` is merged for secrets. Public `NEXT_PUBLIC_*` also live in base `apphosting.yaml` as a safety net.
* Repo `apphosting.yaml` + `apphosting.staging.yaml` on `main`. Node **22** via `package.json` `engines.node`.

### Cloudflare Turnstile on staging (always-pass test keys)

Cloudflare’s documented **always-pass** pair works for staging QA:

| Role | Value |
| :--- | :--- |
| Site key (public, in yaml) | `1x0000000000000000000000000000000AA` |
| Secret key (Secret Manager) | `1x0000000000000000000000000000000AA` |

`apphosting.staging.yaml` sets `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to the site key above (baked into `widget.js` at App Hosting BUILD). Set `CLOUDFLARE_TURNSTILE_SECRET_KEY` to the matching secret. Do **not** use these always-pass keys in production.

### 1. Create the six core Secret Manager secrets

From a machine with Firebase CLI logged into the **styleflo-staging** Google account. Generate the two random signing/encryption keys locally first:

```bash
# Random keys (paste into the matching secrets:set prompts below)
openssl rand -hex 32   # → CHAT_SESSION_SIGNING_SECRET
openssl rand -hex 32   # → TOKEN_ENC_KEY
```

Then create each secret (prompts for the value; never commit values):

```bash
firebase apphosting:secrets:set NEXT_PUBLIC_SUPABASE_ANON_KEY --project styleflo-staging
firebase apphosting:secrets:set SUPABASE_SERVICE_ROLE_KEY --project styleflo-staging
firebase apphosting:secrets:set GEMINI_API_KEY --project styleflo-staging
firebase apphosting:secrets:set CLOUDFLARE_TURNSTILE_SECRET_KEY --project styleflo-staging
firebase apphosting:secrets:set CHAT_SESSION_SIGNING_SECRET --project styleflo-staging
firebase apphosting:secrets:set TOKEN_ENC_KEY --project styleflo-staging
```

Value sources:

* `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` — Supabase dashboard for project `lriugykhrfnnouexqqhm` (anon + service_role).
* `GEMINI_API_KEY` — Google AI Studio / Gemini API key used for staging (not the live production key if you want isolation).
* `CLOUDFLARE_TURNSTILE_SECRET_KEY` — use `1x0000000000000000000000000000000AA` for always-pass staging (see above).
* `CHAT_SESSION_SIGNING_SECRET` / `TOKEN_ENC_KEY` — from `openssl rand -hex 32` (unique to staging).

Aliases in yaml (same Secret Manager name, no extra create): `SUPABASE_ANON_KEY` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`; `GOOGLE_GENERATIVE_AI_API_KEY` → `GEMINI_API_KEY`.

### 2. Grant the App Hosting backend access

```bash
firebase apphosting:secrets:grantaccess NEXT_PUBLIC_SUPABASE_ANON_KEY --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:grantaccess SUPABASE_SERVICE_ROLE_KEY --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:grantaccess GEMINI_API_KEY --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:grantaccess CLOUDFLARE_TURNSTILE_SECRET_KEY --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:grantaccess CHAT_SESSION_SIGNING_SECRET --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:grantaccess TOKEN_ENC_KEY --backend delightful-kepler --project styleflo-staging
```

Alternatively, in Cloud Console → Secret Manager → each secret → Permissions → grant **Secret Manager Secret Accessor** to the App Hosting runtime service account (`firebase-app-hosting-compute@styleflo-staging.iam.gserviceaccount.com`).

### 3. Confirm Environment name is `staging` (Stuart — console)

Firebase console → App Hosting → backend `delightful-kepler` → **Settings → Environment** → Environment name = exactly **`staging`**.

Without that name, `apphosting.staging.yaml` is **not** merged (service-role and other secrets missing at RUNTIME). Public env is still applied from base `apphosting.yaml`.

### 4. Grant BUILD access for the anon key (Stuart — CLI if rollout still fails prerender)

`NEXT_PUBLIC_SUPABASE_ANON_KEY` must be available at **BUILD** (Next inlines `NEXT_PUBLIC_*` into prerendered pages). If Secret Manager access was only granted for runtime, re-run:

```bash
firebase apphosting:secrets:grantaccess NEXT_PUBLIC_SUPABASE_ANON_KEY --backend delightful-kepler --project styleflo-staging
```

### 5. Trigger a manual rollout

Automatic rollouts are **OFF**. After the six secrets are set and Environment name is `staging`:

* Console: App Hosting → `delightful-kepler` → **Roll out** / create rollout from `main`, **or**
* CLI: `firebase apphosting:rollouts:create delightful-kepler --git-branch main --project styleflo-staging`

#### Build OOM / TypeScript heap (STYL-203)

App Hosting Cloud Build uses **e2-medium (~4 GB RAM)** by default (not configurable in `apphosting.yaml` today). Next 16’s embedded typecheck during `next build` OOMs at Node’s default ~2 GB heap after a successful compile.

`apphosting.yaml` therefore sets **BUILD-only**:

* `STYL_APPHOSTING_BUILD=1` → `next.config.ts` sets `typescript.ignoreBuildErrors` so App Hosting skips the duplicate `tsc` (CI **Typecheck and Playwright** and production `deploy.yml` still run `npm run typecheck`).
* `NODE_OPTIONS=--max-old-space-size=3072` → gives Turbopack headroom under the 4 GB VM (4 GB heap would be unsafe).

Neither variable is available at **RUNTIME** (Cloud Run staging stays at `memoryMiB: 1024`). Production Cloud Run Docker builds do **not** set `STYL_APPHOSTING_BUILD`, so they still typecheck inside `next build` after CI has already passed.

#### `/login` prerender + missing `NEXT_PUBLIC_*` (STYL-203)

Build `f287d45b` compiled in ~62s (heap fix) then failed prerendering `/login` because `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` were undefined at BUILD. `assert-staging-env.mjs` had passed because `APP_ENV` was unset when `apphosting.staging.yaml` was not merged.

Repo fix:

* Base `apphosting.yaml` carries staging plain `NEXT_PUBLIC_*` + anon secret with **BUILD + RUNTIME**.
* `/login`, `/register`, `/onboard` create the browser Supabase client lazily (`src/lib/supabase-browser.ts`) so prerender cannot throw.

### 6. Smoke-check the staging URL

Open `https://delightful-kepler--styleflo-staging.europe-west4.hosted.app`:

* Visible **STAGING** banner and `X-Robots-Tag: noindex`.
* Page source / network must **not** contain live ref `tkoasyjvrgaglofpzduq`.
* `/widget.js` loads; `/api/chatbots/<id>` returns staging data.
* Unset feature secrets (Stripe, Twilio, …) must **not** crash boot — those routes return errors / no-ops until secrets are added.

### Feature secrets to add later

These are **not** in `apphosting.staging.yaml` (so missing secrets cannot fail a rollout). Add a secret, grant access, then add a matching `secret:` entry to `apphosting.staging.yaml` (or the Firebase console) and roll out again.

Note: **`STRIPE_WEBHOOK_SECRET` is unused in `src/`** — do not create it for staging unless a future webhook verifier is added.

#### Stripe test

```bash
firebase apphosting:secrets:set STRIPE_SECRET_KEY --project styleflo-staging
firebase apphosting:secrets:grantaccess STRIPE_SECRET_KEY --backend delightful-kepler --project styleflo-staging
# STRIPE_WEBHOOK_SECRET — unused in src; skip unless webhook verification is added later
```

#### Mailgun sandbox

```bash
firebase apphosting:secrets:set MAILGUN_API_KEY --project styleflo-staging
firebase apphosting:secrets:grantaccess MAILGUN_API_KEY --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set MAILGUN_DOMAIN --project styleflo-staging
firebase apphosting:secrets:grantaccess MAILGUN_DOMAIN --backend delightful-kepler --project styleflo-staging
```

#### Twilio (test account)

```bash
firebase apphosting:secrets:set TWILIO_ACCOUNT_SID --project styleflo-staging
firebase apphosting:secrets:grantaccess TWILIO_ACCOUNT_SID --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set TWILIO_AUTH_TOKEN --project styleflo-staging
firebase apphosting:secrets:grantaccess TWILIO_AUTH_TOKEN --backend delightful-kepler --project styleflo-staging
```

#### Vapi

```bash
firebase apphosting:secrets:set NEXT_PUBLIC_VAPI_PUBLIC_KEY --project styleflo-staging
firebase apphosting:secrets:grantaccess NEXT_PUBLIC_VAPI_PUBLIC_KEY --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set VAPI_API_KEY --project styleflo-staging
firebase apphosting:secrets:grantaccess VAPI_API_KEY --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set VAPI_MASTER_ASSISTANT_ID --project styleflo-staging
firebase apphosting:secrets:grantaccess VAPI_MASTER_ASSISTANT_ID --backend delightful-kepler --project styleflo-staging
# Optional alias: VAPI_PRIVATE_API_KEY → same secret as VAPI_API_KEY
```

#### Meta / WhatsApp

```bash
firebase apphosting:secrets:set NEXT_PUBLIC_META_APP_ID --project styleflo-staging
firebase apphosting:secrets:grantaccess NEXT_PUBLIC_META_APP_ID --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set NEXT_PUBLIC_META_ES_CONFIG_ID --project styleflo-staging
firebase apphosting:secrets:grantaccess NEXT_PUBLIC_META_ES_CONFIG_ID --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set META_ACCESS_TOKEN --project styleflo-staging
firebase apphosting:secrets:grantaccess META_ACCESS_TOKEN --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set META_APP_SECRET --project styleflo-staging
firebase apphosting:secrets:grantaccess META_APP_SECRET --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set META_VERIFY_TOKEN --project styleflo-staging
firebase apphosting:secrets:grantaccess META_VERIFY_TOKEN --backend delightful-kepler --project styleflo-staging
```

#### Google / Microsoft calendar OAuth

```bash
firebase apphosting:secrets:set GOOGLE_CLIENT_ID --project styleflo-staging
firebase apphosting:secrets:grantaccess GOOGLE_CLIENT_ID --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set GOOGLE_CLIENT_SECRET --project styleflo-staging
firebase apphosting:secrets:grantaccess GOOGLE_CLIENT_SECRET --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set MICROSOFT_CLIENT_ID --project styleflo-staging
firebase apphosting:secrets:grantaccess MICROSOFT_CLIENT_ID --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set MICROSOFT_CLIENT_SECRET --project styleflo-staging
firebase apphosting:secrets:grantaccess MICROSOFT_CLIENT_SECRET --backend delightful-kepler --project styleflo-staging
```

#### Places

```bash
firebase apphosting:secrets:set GOOGLE_PLACES_SERVER_API_KEY --project styleflo-staging
firebase apphosting:secrets:grantaccess GOOGLE_PLACES_SERVER_API_KEY --backend delightful-kepler --project styleflo-staging
```

#### ElevenLabs

```bash
firebase apphosting:secrets:set ELEVENLABS_API_KEY --project styleflo-staging
firebase apphosting:secrets:grantaccess ELEVENLABS_API_KEY --backend delightful-kepler --project styleflo-staging
```

#### WordPress

```bash
firebase apphosting:secrets:set WPMUDEV_WEBHOOK_SECRET --project styleflo-staging
firebase apphosting:secrets:grantaccess WPMUDEV_WEBHOOK_SECRET --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set STYLEFLO_WP_API_SECRET --project styleflo-staging
firebase apphosting:secrets:grantaccess STYLEFLO_WP_API_SECRET --backend delightful-kepler --project styleflo-staging
```

#### Cron / OpenClaw

```bash
firebase apphosting:secrets:set CRON_SECRET --project styleflo-staging
firebase apphosting:secrets:grantaccess CRON_SECRET --backend delightful-kepler --project styleflo-staging
firebase apphosting:secrets:set OPENCLAW_BEARER_TOKEN --project styleflo-staging
firebase apphosting:secrets:grantaccess OPENCLAW_BEARER_TOKEN --backend delightful-kepler --project styleflo-staging
```

### Fallback if App Hosting + Next.js 16 cannot work

If the adapter still cannot build or serve Next.js 16 after the dependency fix: stop and use **Firebase Hosting** with a rewrite to a **Cloud Run** service in the staging project (**europe-west2**), built from the existing `Dockerfile` (with required build-args, no live fallbacks). Do not implement that fallback in this ticket unless Next 16 is proven incompatible.

### CI guard

`npm run check:staging-no-live-ref` (also in the Playwright workflow) fails if `tkoasyjvrgaglofpzduq` appears in `apphosting.yaml` or `apphosting.staging.yaml`.

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
