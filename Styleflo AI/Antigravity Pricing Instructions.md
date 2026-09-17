---
date: 2026-09-17
tags:
  - styleflo
  - antigravity
  - instructions
  - database
  - billing
status: active
---
# Antigravity Implementation Instructions: Modular Pricing & Billing Architecture

**NOTICE:** Per vault rules, this instruction set has been verified against connected documentation to ensure no existing functionality is broken.

## 1. Database Schema Migrations (`supabase/migrations/`)
- **Subscription Tiers:** Deprecate legacy multi-tier schemas and establish the single **£9.99/mo Base Tier** record (`base_tier`).
- **Modular Bolt-ons Schema:** Create relational tables/flags for optional add-ons:
  - `landline_addon` (£8.99–£19.00/mo, includes 10–30 shared voice minutes)
  - `mobile_addon` (£10.99–£14.99/mo, includes 50–250 SMS + shared voice minutes)
  - `whatsapp_addon` (£19.99 primary / £9.99 add-on, includes 500 messages)
- **Usage & Ledger Roll-over Logic:** Update `usage_ledger` to support the **3-month roll-over rule** for sliding voice packs and sliding SMS packs.

## 2. Superadmin Pricing Matrix UI (`PricingMatrixView.tsx`)
- Refactor the superadmin matrix from rigid multi-tier columns into a modular component builder where admins configure:
  - Base Subscription Fee (£9.99/mo)
  - Landline ranges and included shared minutes
  - Mobile ranges and included SMS buffers
  - WhatsApp primary/addon pricing
  - Sliding voice packs (20m/£15, 50m/£30, 100m/£50)
  - Sliding SMS packs (100/£5.99, 500/£14.99)
- Ensure all values display in **GBP (£)** and record audit logs with timestamp addendums at the base of the page.

## 3. Feature Gating & Entitlements (`checkFeatureEntitlement`)
- Remove native calendar requirement gating from the base subscription.
- Rewrite entitlement checks to evaluate **active modular bolt-ons** (`has_landline`, `has_mobile`, `has_whatsapp`) rather than flat tier levels.
- Grey out unpurchased channels in the sidebar; clicking them must trigger an inline modal prompting the user to add the bolt-on via Stripe.

## 4. Stripe & Webhook Integration
- Map Stripe recurring items to support the base £9.99 subscription combined with independent, metered or flat-rate recurring add-on line items.
- Ensure automated account unlocking upon successful webhook confirmation from Stripe.
