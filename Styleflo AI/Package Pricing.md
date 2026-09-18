---
date: 2026-09-17
tags:
  - styleflo
  - requirements
  - antigravity
  - pricing
status: active
---
# Styleflo AI - Modular Pricing & Feature Requirements (Antigravity Specification)

## Overview & Objectives
This specification outlines the restructured modular pricing model for Styleflo AI. The model moves away from rigid multi-tier packages to a low-friction entry point (**£9.99/mo Base Tier**) paired with flexible, a la carte channel add-ons (Landlines, Mobiles, WhatsApp) and sliding usage packs (Voice minutes and SMS) with a 3-month roll-over rule.

---

## 1. Core Entry Tier
* **Price:** **£9.99 / month** (or £99.90 / year)
* **Included Features:**
  * AI Chatbot (web widget, knowledge base, website integration)
  * Lead capture & web presence
  * **10 Voice Minutes** included per month
* **Calendar Booking:** Excluded (users keep their existing booking tools/links).

---

## 2. Modular Channel Bolt-ons
Users can add communication channels independently without being forced into rigid higher software tiers:

* **Local Landline Bolt-on:** **£8.99 – £19.99 / month**
  * Includes dedicated landline number + **shared voice minute pool** (10–30 shared minutes; sliding scale in £1 multiples).
* **Mobile Number Bolt-on:** **£10.99 – £14.99 / month**
  * Includes dedicated mobile number + **50 to 250 SMS messages** + **shared voice minutes** (sliding scale in £1 multiples).
* **WhatsApp Bolt-on:** **£19.99 / month** (standalone primary) or **£9.99 / month** (as an add-on bundle)
  * Includes **500 messages included** per month (backed by Twilio / Meta API).

---

## 3. Sliding Usage Packs (With 3-Month Roll-Over)
Unused minutes and SMS credits roll over for up to 3 months as long as an active subscription is maintained.

### Sliding Voice Packs:
* **20 mins:** £15.00
* **50 mins:** £30.00
* **100 mins:** £50.00

### Sliding SMS Packs:
* **100 SMS:** £5.99
* **500 SMS:** £14.99

---

## 4. Universal Features & Excluded Items
* **Universal Defaults (Enabled on all accounts):** `web_presence`, `web_widget`, `ai_agent`, `website_chatbot`, `lead_capture`.
* **Excluded / Unannounced Features:** `custom_domain`, `inventory_control`, `crm_zapier_sync`, `email_marketing` (must not be displayed in UI).

---

## 5. UI/UX & Feature Gating Requirements
1. **Feature Gating:** 
   - Lock, grey out, or hide unavailable features/channels. Clicking a locked feature opens an upgrade/bolt-on modal linking directly to Stripe checkout.
2. **Currency & Superadmin:** 
   - All pricing must be displayed in **GBP (£)** across `app.styleflo.ai/superadmin` and landing pages.
   - Any pricing changes must log a superadmin audit trail (date, time, summary) and append an addendum at the base of the page.
3. **Landing Page Sync:** 
   - Superadmin pricing matrix updates must dynamically sync to `styleflo.ai`.

---

## 6. Metered Usage & Capacity Thresholds (85% Rule)
If any user account reaches **85% capacity** on metered items (Knowledge Base chunks, Voice minutes, SMS allowances), a dashboard banner must appear offering pro-rata top-ups or bolt-on upgrades via Stripe.
