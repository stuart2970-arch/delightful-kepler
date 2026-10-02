---
name: local-testing-environment
description: Best practices and instructions for managing local testing configuration (.env.test vs .env.local), local Supabase DB CLI execution, and preventing automated test runs from mutating live databases or sending outbound spam emails.
---

# Local Testing Environment & Dual Config Management

## Overview & Core Purpose

This project maintains two distinct local environment configuration files to isolate automated Playwright test execution from standard development:

1. **`.env.local` (Development against Cloud Supabase)**
   - Used by `npm run dev`.
   - Points to the live Cloud Supabase database (`https://tkoasyjvrgaglofpzduq.supabase.co`).
   - Contains live development API credentials (Mailgun, Twilio, Stripe, Vapi, Gemini, etc.).

2. **`.env.test` (Isolated Automated Testing against Local Supabase DB)**
   - Used by `npm run test:e2e`, `npm run test:server`, and Husky pre-push hooks.
   - Points to the **local spun-up Supabase DB** (`http://127.0.0.1:54321`).
   - Uses local Supabase CLI JWT secrets and keys.
   - **MUST NOT** use live Mailgun API keys to guarantee zero spam email dispatching during test runs. All outbound test emails are trapped in local Inbucket (`http://127.0.0.1:54324`).

> [!CAUTION]
> NEVER overwrite `.env.test` with credentials from `.env.local`. Overwriting `.env.test` with live cloud credentials will cause test suites to mutate production database tables, pollute cloud analytics, and trigger spam email dispatching to real users.

---

## Environment File Breakdown

| Configuration Variable | `.env.local` (Development) | `.env.test` (Local Test DB) |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://tkoasyjvrgaglofpzduq.supabase.co` | `http://127.0.0.1:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cloud Anon Key | Local Supabase CLI Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Cloud Service Role Key | Local Supabase CLI Service Role Key |
| `MAILGUN_API_KEY` | Real Mailgun API Key | `mock_mailgun_api_key_for_local_testing` |
| `NEXT_PUBLIC_APP_URL` | Live URL / Ngrok | `http://localhost:3000` |

---

## Runbook: Running Tests Locally

### Step 1: Start Local Supabase DB
Before running E2E Playwright tests or test server scripts, spin up local Supabase DB:
```bash
npx supabase start
```
Verify services are running with:
```bash
npx supabase status
```

### Step 2: Run Automated Playwright Tests
Execute Playwright test suite (uses `dotenv -e .env.test` automatically via `package.json`):
```bash
npm run test:e2e
```
Or run interactive UI mode:
```bash
npm run test:e2e:ui
```

### Step 3: Local Mail Inspection
Access local Inbucket web UI at:
```
http://127.0.0.1:54324
```
All transactional emails generated during test runs appear here.

---

## Safeguards & Troubleshooting

- **If tests report `AuthApiError: Invalid login credentials`**:
  Do **NOT** copy cloud credentials into `.env.test`. Instead, ensure local Supabase is running (`npx supabase start`) and seeded (`npx supabase db reset`).
- **If tests fail due to port conflicts**:
  Ensure no orphaned Next.js instances are running on port 3000 (`Get-Process -Name node | Stop-Process` on Windows PowerShell).
