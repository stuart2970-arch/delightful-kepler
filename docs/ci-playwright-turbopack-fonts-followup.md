# Follow-up: Turbopack + `next/font/google` on parallel Playwright CI jobs

**Out of scope for PR #109** (workflow / CI / test grouping only).

## Symptom

On `ubuntu-24.04` area jobs, the Playwright `webServer` (`next dev` + Turbopack) sometimes:

- Fails to resolve `@vercel/turbopack-next/internal/font/google/font`, or
- Times out at 180s while compiling routes that pull `next/font/google` multi-weight bundles.

Staging already uses `PLAYWRIGHT_TEST` + `root-fonts-playwright.ts` (single weight per family). That is sufficient locally and on most jobs, but **billing-stripe-entitlements** (many route-heavy specs) still hit Turbopack font flakes when 8 jobs run in parallel.

## Mitigations tried (not merged in #109)

- Turbopack `resolveAlias` for `root-fonts-production` → `root-fonts-playwright`
- Stub fonts without `next/font/google` + alias `src/lib/fonts/index.ts` → `index.playwright.ts`

Those work but touch **app/runtime** code and `next.config.ts`.

## Implemented (STYL-408)

When `PLAYWRIGHT_TEST=true` or `CI` is set, and `NODE_ENV` is not `production`, `deterministicCiFontsEnabled()` in `next.config.ts` aliases `@/lib/fonts` to `src/lib/fonts/ci-font-entry.ts`. That entry does not import `next/font/google`. Production builds keep `turbopack: {}` and `src/lib/fonts/index.ts` (multi-weight Inter and Poppins).

`globMatch` in `scripts/ci-playwright-paths.mjs` treats a double-star between slashes as zero or more directories, so `src/components/ServiceEditor.tsx` selects the booking area.

## Options for a dedicated ticket

1. App-hosting-safe Playwright-only font entry (no production bundle side effects).
2. CI-only `next dev --webpack` for Playwright (if still supported).
3. Pre-warm a production build + `next start` for CI instead of Turbopack dev.
4. Pin / patch Turbopack once upstream fixes parallel google-font resolution.

## Unrelated but required for auth area

CI must **not** `docker stop` `supabase_inbucket_*` (mail capture on `54324`). Fixed in #109 workflow trim step only.