# StyleFlo AI — Example Agents & Zero-Bounce Dummy Account Strategy

**Role:** Senior Business Analyst & Systems Architect  
**Project:** StyleFlo AI Client Showcase & Supabase Deliverability Protection  
**Date:** September 2026  
**Status:** Investigation & Strategic Recommendations (No Code Phase)  

---

## Executive Summary

Supabase has issued a warning regarding a high volume of **bounced emails** originating from dummy / test email addresses. High email bounce rates (>2–5%) trigger automated reputation penalties from Supabase and shared SMTP relays, risking account suspension or complete disabling of transactional emails.

At the same time, StyleFlo requires a compelling mechanism to showcase **example AI agents** (e.g. Hair Salon, Aesthetics Clinic, Barbershop, Day Spa) to potential B2B clients during sales demos, pitch presentations, and marketing campaigns.

This document investigates:
1. **The Exact Root Cause:** Why Supabase is dispatching emails to dummy addresses and where they originate.
2. **Four Architectural Patterns for Example Agents:** From public interactive widgets to 1-click sandbox dashboards.
3. **The Zero-Bounce Strategy:** Strict protocols and technical safeguards to ensure dummy and demo accounts never trigger outbound SMTP emails.

---

## 1. Root Cause Analysis: Why Supabase is Bouncing Emails

### 1.1. The Mechanism of `supabase.auth.signUp()`
When a user registers via the public frontend signup form (`src/app/login/page.tsx` or `src/app/register/page.tsx`), the application invokes the standard client-side SDK method:

```typescript
// PUBLIC SIGNUP FLOW:
const { data, error } = await supabase.auth.signUp({
  email: 'sarah.miller@acme.com',
  password: '...',
});
```

By default, Supabase Auth has **"Enable Email Confirmations"** turned ON. When `signUp()` is called:
1. Supabase creates a user record in `auth.users` with `confirmed_at = NULL`.
2. Supabase immediately queues and sends an automated **"Confirm your signup"** verification email to the provided address.
3. If the email domain does not exist, lacks valid MX records, or is a dummy placeholder (e.g. `@acme.com`, `@fake.com`, `@test.com`), the receiving mail server immediately issues an **SMTP 550 / User Unknown / Host Not Found hard bounce**.
4. Supabase monitors bounce rates on its mail pool. When bounces exceed 2–3%, automated flags are triggered.

### 1.2. The Hidden Culprit: Automated Pre-Push E2E Tests
Our analysis of the codebase revealed a recurring source of automated dummy signups:
- File: [`tests/multi-colleague.spec.ts`](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/tests/multi-colleague.spec.ts)
- On lines 110–120, the test visits `/login?mode=register` and submits:
  `email: 'sarah.miller@acme.com'`
- **Because Playwright runs on every single `git push` via Husky pre-push hooks**, Supabase has been receiving automated signup attempts with `@acme.com` dozens of times per week. Each test execution triggers an actual outbound email from Supabase to a non-existent domain!

### 1.3. Manual Test Accounts
When team members or developers manually create test accounts in the registration UI using placeholder addresses (`test12@gmail.com`, `user@example.com`, etc.), each attempt fires another bouncing email.

---

## 2. Four Architectural Models for Displaying Example Agents

Potential clients evaluating StyleFlo have different needs. We evaluated four approaches:

```
┌────────────────────────────────────────────────────────────────────────┐
│                      EXAMPLE AGENT SHOWCASE OPTIONS                    │
└────────────────────────────────────────────────────────────────────────┘

 [ Option 1: Public Web Showcase ]   ──► No login required
                                         Live chat/voice widgets on site
                                         Zero Supabase involvement

 [ Option 2: Pre-Seeded Demo Tenant ] ──► Permanent "Showcase Salon"
                                         Seeded via Admin API (Zero Email)
                                         Superadmin or Sales Rep login

 [ Option 3: 1-Click Guest Sandbox ]  ──► Prospective client clicks "Live Demo"
                                         Auto-generates temporary session
                                         Zero signup form, zero email

 [ Option 4: Subaddressing Protocol ] ──► Used for any manual demo accounts
                                         Uses real domain: `demo+hair@styleflo.ai`
                                         Valid MX, zero hard bounces
```

---

### Option 1: Public Interactive Showcase Gallery (Highest Conversion — Recommended for Marketing)
**Concept:** Prospective clients do not want to fill out a registration form just to test an example chatbot.
- Create a public showcase page at `app.styleflo.ai/demo` or on the marketing site (`styleflo.ai/examples`).
- Feature 4 tabbed interactive personas:
  1. **💇‍♀️ Luxe Locks Hair Lounge:** Demonstrates booking cut & color, stylist matching, and pricing questions.
  2. **💅 Velvet Nail & Day Spa:** Demonstrates treatment menus, add-on treatments, and Saturday availability.
  3. **💈 The Grooming Room Barbers:** Demonstrates quick beard trims, walk-in inquiries, and quick slots.
  4. **💉 Pure Glow Aesthetics Clinic:** Demonstrates medical consultation booking and patch test disclaimers.
- **Why this works:** The chatbot already has unauthenticated public endpoints ([`/api/chat/public-init`](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/src/app/api/chat/public-init/route.ts) and [`/api/chat/stream`](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/src/app/api/chat/stream/route.ts)). The widgets can run live in the browser without any user account existing!
- **Email Impact:** **0 emails sent. Zero bounce risk.**

---

### Option 2: Pre-Seeded Permanent Demo Tenants (Recommended for Sales Demos)
**Concept:** When a sales representative is conducting a live pitch or video walkthrough, they need to show the **full backend dashboard** (Master Schedule, Colleague Rotas, Inbound Voice Calls, Conversation Explorer, Analytics).
- Create 4 dedicated permanent tenants in Supabase:
  - Tenant 1: `Luxe Locks Studio` (Hair Salon)
  - Tenant 2: `Velvet Spa & Nails` (Beauty / Spa)
  - Tenant 3: `The Grooming Room` (Barber)
  - Tenant 4: `Aura Aesthetics` (Skin Clinic)
- Each tenant is pre-populated with:
  - Realistic staff colleagues (e.g. "Sarah - Senior Stylist", "James - Master Barber").
  - 4 weeks of populated appointments in the calendar.
  - Active call transcripts and conversation history.
  - Configured knowledge base and services menu.
- **Access Method:**
  - Sales reps can access these tenants directly using Superadmin Impersonation (`/api/superadmin/impersonate/search`), or
  - Log in directly using pre-verified credentials (e.g. `demo-hair@styleflo.ai`).

---

### Option 3: 1-Click Interactive "Sandbox Dashboard" (Self-Serve Exploration)
**Concept:** Allow prospects visiting the landing page to click *"Experience Demo Dashboard"* and land inside a pre-populated dashboard without registering.
- The user clicks a button: `[ Try Interactive Demo ]`.
- A server route ([`/api/auth/demo-session`](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/src/app/api/auth/demo-session)) sets a temporary, read-only session cookie pointing to the Demo Tenant.
- The prospect explores the dashboard in real-time, plays with the rota, and tests the chatbot.
- **Email Impact:** **0 emails sent.** The user never provides an email address, eliminating bounce risk.

---

## 3. The Zero-Bounce Technical Strategy for Supabase

To permanently resolve Supabase's bounce warnings while allowing team testing and demo creation, we must enforce three rules:

### Rule 1: Always Use `supabaseAdmin.auth.admin.createUser()` with `email_confirm: true`
When creating accounts programmatically or via seeding scripts, **never use `supabase.auth.signUp()`**.

```typescript
// SAFE ADMIN CREATION (ZERO EMAILS SENT):
const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
  email: 'demo-hair@styleflo.ai',
  password: 'SecureTemporaryPassword123!',
  email_confirm: true, // <-- CRITICAL: Tells Supabase the email is verified!
  user_metadata: {
    full_name: 'Luxe Locks Demo',
    company_name: 'Luxe Locks Studio',
    is_demo_account: true,
  },
});
```
**Why this prevents bounces:**
Setting `email_confirm: true` tells Supabase's authentication engine that the user has already validated their email. Supabase sets `confirmed_at = NOW()` directly in Postgres and **completely suppresses the outgoing confirmation email**. No message enters the SMTP queue.

---

### Rule 2: Subaddressing on StyleFlo's Real Domain
If an email address must be entered in any public or automated form, **never use fake domains** (`@acme.com`, `@fake.com`, `@test.com`, `@example.com`).

Instead, use **plus-addressing (subaddressing)** on the verified `@styleflo.ai` domain:
- `demo+hair@styleflo.ai`
- `demo+barber@styleflo.ai`
- `demo+aesthetics@styleflo.ai`
- `test+playwright@styleflo.ai`

**Why this works:**
- Every mail server (Google Workspace, Microsoft 365, etc.) treats `username+tag@domain.com` as a single mailbox (`username@domain.com`).
- The DNS and MX records are 100% valid.
- If Supabase ever dispatches an email, the message is successfully delivered to the master `demo@styleflo.ai` or `team@styleflo.ai` inbox (HTTP 250 OK).
- **Bounce Rate: 0.00%.**

---

### Rule 3: Decouple E2E Playwright Tests from Live SMTP
The pre-push test [`tests/multi-colleague.spec.ts`](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/tests/multi-colleague.spec.ts) must be updated:
1. Instead of submitting `sarah.miller@acme.com` to the live signup form on every test run, use:
   - A subaddressed test email (`test+colleague@styleflo.ai`), OR
   - Create the colleague user record directly via a test setup API route using `supabaseAdmin.auth.admin.createUser({ email_confirm: true })`.
2. This immediately eliminates dozens of bouncing emails generated during local development and CI/CD pipelines.

---

### Rule 4: Supabase "Send Email" Auth Hook (Optional Defense-in-Depth)
Supabase allows configuring a Postgres Auth Hook or HTTP webhook that intercepts all outgoing authentication emails before they reach the SMTP server.

In SQL:
```sql
-- Conceptual Hook: Suppress emails to demo or test domains
CREATE OR REPLACE FUNCTION public.custom_send_email_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
BEGIN
  -- If the recipient is a demo or test address, exit silently without sending
  IF event->'user'->>'email' LIKE '%@demo.styleflo.ai' 
     OR event->'user'->>'email' LIKE 'test+%@styleflo.ai' THEN
    RETURN jsonb_build_object('error', null);
  END IF;

  -- Allow normal customer emails to proceed
  RETURN event;
END;
$$;
```

---

## 4. Comparison Matrix of Solutions

| Approach | Best For | Implementation Effort | Supabase Bounce Risk | User Experience |
| :--- | :--- | :--- | :--- | :--- |
| **Option 1: Public Web Showcase** | Marketing website, prospective leads | Low (1–2 days) | **Zero (No email)** | ⭐⭐⭐⭐⭐ Frictionless; test agent immediately |
| **Option 2: Pre-Seeded Demo Tenants** | Sales rep pitches, video walk-throughs | Low (1 day) | **Zero (`email_confirm: true`)** | ⭐⭐⭐⭐⭐ Realistic, full dashboard preview |
| **Option 3: 1-Click Guest Sandbox** | Self-serve lead evaluation | Medium (2–3 days) | **Zero (Guest cookie)** | ⭐⭐⭐⭐ High delight; zero signup friction |
| **E2E Test Sanitization** | Protecting Supabase SMTP reputation | Low (30 mins) | **Zero (Eliminates daily bounces)** | Internal reliability |

---

## 5. Recommended Step-by-Step Action Plan

1. **Immediate Step (Fix the Test Suite)**:
   - Update `tests/multi-colleague.spec.ts` to replace `sarah.miller@acme.com` with a subaddressed address or admin-created pre-confirmed user, instantly halting daily automated bounces.
2. **Phase 1: Seed 4 Example Industry Tenants**:
   - Run a database seeding script using `supabaseAdmin.auth.admin.createUser({ email_confirm: true })` to create four distinct demo tenants with rich data (Hair Salon, Aesthetics, Barber, Spa).
3. **Phase 2: Build Public Showcase Page**:
   - Create a clean showcase UI where prospective clients can interact with the 4 example agents directly in the browser without entering an email.
4. **Phase 3: Sales Rep Impersonation Access**:
   - Enable sales team members to jump into any of the 4 demo tenant dashboards in 1-click via the Superadmin Control Center.
