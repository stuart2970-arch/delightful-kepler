# StyleFlo Conversational Onboarding Spec (v2 Integration)

This document details the architecture and operational flow of StyleFlo's Conversational Onboarding system within `delightful-kepler`.

## 🏗️ Global State Machine

```
       [ STATE 0: IDLE ]
               │
               ▼ User initiates onboarding
     [ STATE 1: ENROLLMENT ] ───────(Turnstile Front-Door Challenge + Email/Password -> Supabase Auth)
               │                     * Generates unique Resumption Code (e.g. FLO-8921)
               │                     * If user drops off, automated recovery email triggers in 15m
               ▼
     [ STATE 2: IDENTITY ]   ───────(Confirm Google Places details OR Input Mobile City/Radius)
               │
               ▼
     [ STATE 3: INGESTION ]  ───────(Website sitemap selection OR PDF upload + FAQ text)
               │
               ▼
     [ STATE 4: LOGISTICS ]  ───────(Selects 1 of 4 booking modes)
               │
               ▼
      [ STATE 5: LAUNCH ]    ───────(Dashboard Redirection)
```

## 🛡️ Security Architecture

1. **Front-Door Turnstile Challenge**: Unauthenticated public routes (`/api/auth/signup` and `/api/chat/public-init`) require invisible Cloudflare Turnstile token validation using `application/x-www-form-urlencoded`.
2. **Session JWT Verification**: Authenticated chat stream requests (`/api/chat/stream`) pass `Authorization: Bearer <JWT>` or `x-session-token` verified locally at the Edge in `<1ms`.
3. **Database Row-Level Security (RLS)**: Vector document chunks (`public.document_chunks`) and document metadata (`public.documents`) enforce strict `tenant_id = public.get_auth_tenant_id()` policies.

## 📧 Drop-Off Recovery System

- **Automated Email Trigger**: Checks for tenants with `onboarding_status = 'in_progress'` after 15 minutes of inactivity.
- **Resumption Code**: Users can resume by entering `FLO-XXXX` into the chat bar or clicking magic links with `?resume=token`.
