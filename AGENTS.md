<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project Session Logging Rule
Always read and digest the `README.md` file each time a new session starts. After each code change or significant session milestone, append a log of the update and a summary of the conversation to the `## Session Chat History Log` section at the end of the `README.md` file.

# Superadmin Endpoint Authorization (STYL-178 Directive)
All endpoints under `/api/superadmin/*` (and any other admin-only endpoints) MUST be protected by the shared superadmin auth helper in `src/lib/auth/require-superadmin.ts`.

### Usage Patterns:
1. **Route Handler Wrapper (`withSuperAdmin`)**:
   ```typescript
   import { withSuperAdmin } from '@/lib/auth/require-superadmin';

   // Wrap exported route handlers (GET, POST, PATCH, DELETE)
   export const GET = withSuperAdmin(async (req, ctx, admin) => {
     // admin.userId is the verified superadmin user ID
     return NextResponse.json({ success: true });
   });

   export const PATCH = withSuperAdmin(async (req, ctx, admin) => {
     // Always use admin.userId as performed_by for audit logging
     const body = await req.json();
     return NextResponse.json({ success: true });
   });
   ```

2. **Inline Gate (`requireSuperAdmin`)**:
   ```typescript
   import { requireSuperAdmin } from '@/lib/auth/require-superadmin';

   export async function POST(req: NextRequest) {
     const auth = await requireSuperAdmin(req);
     if (!auth.ok) {
       return auth.response; // Returns 401 (no login) or 403 (non-superadmin)
     }
     // Safe to proceed: auth.userId is verified
   }
   ```

3. **User Authentication Gate (`requireUser`)**:
   For routes accessible to any authenticated user (e.g., `GET /api/global-holidays`):
   ```typescript
   import { requireUser } from '@/lib/auth/require-superadmin';

   export async function GET(req: NextRequest) {
     const auth = await requireUser(req);
     if (!auth.ok) return auth.response; // 401
   }
   ```

# Calendar Availability & Quick-Links Protocol (STYL-182 Directive)
All appointment availability and booking in the chat assistant follow a structured quick-link protocol:
1. **Quick-Link Tags**:
   - `[QUICK_SERVICES:[{ id, name, duration_minutes, price }]]`: Offered when customer requests booking, presents available tenant services.
   - `[QUICK_DAYS:[{ serviceId, staffId, days: [{ date, displayDate, slotsCount }] }]]`: Offered once service is selected, displays distinct bookable dates.
   - `[QUICK_TIMES:[{ date, serviceId, slots: [{ time, start, end, staffId, serviceId }] }]]`: Offered once day is selected, displays available timeslots for that date.
   - `[TIME_SLOTS:[...]]`: Supported as a legacy fallback.

2. **Database & UI Hygiene**:
   - Tags MUST NEVER be visible to the customer in the chat bubble.
   - Tags MUST NEVER be stored in the database `messages` table (stripped via `stripCalendarTags`).
   - Bracket-depth tracking is used for stripping and payload extraction to support nested JSON arrays and objects without regex truncations.

3. **Calendar Providers & Availability Engine**:
   - All provider calls route through `src/lib/calendar/provider.ts` supporting Google Calendar API and Microsoft Graph API (`/me/calendar/getSchedule`).
   - Real calendar busy slots are checked. If a provider fails or is unconfigured, slots are never falsely assumed free.
   - Fallback to contact detail collection occurs cleanly if 0 services or no provider are configured.

4. **Booking & Race Condition Safeguards**:
   - `bookMeeting` re-checks free/busy against both the internal `appointments` table and the external calendar provider before inserting.
   - Idempotency checks prevent duplicate bookings on double-taps within a 1-second timestamp window.

# Bug Fix Regression Tests (STYL-200 Directive)
Every bug fix MUST include a new Playwright test that:
1. Reproduces the bug (fails against the unfixed code), and
2. Passes after the fix,
so the same failure cannot regress silently.

### Git hooks
- Never use `git commit --no-verify`, `git push --no-verify`, or any other flag that skips hooks.
- If a pre-commit or pre-push hook fails, fix the underlying cause (types, tests, lint) and re-run. Do not bypass the hook.

### Local and CI test data isolation
- Never point Playwright tests, `npm run test:server`, or husky hooks at the live Supabase project or live API keys.
- `.env.test` must use the local Supabase CLI stack (`http://127.0.0.1:54321`) and mock third-party keys only.
- Never copy credentials from `.env.local` into `.env.test`.

