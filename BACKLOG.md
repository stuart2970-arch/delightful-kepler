# Product Backlog: Iberian Expansion (Portugal & Spain)

## 📌 Feature Epic: Portugal & Spain SaaS & Chatbot Expansion

### 1. Payment Integrations (Stripe)
- [ ] **[PT-PAY-01] MB WAY Support**: Enable MB WAY digital wallet payments in Stripe Checkout & Payment Elements for Portugal.
- [ ] **[PT-PAY-02] Multibanco Vouchers**: Enable Multibanco ATM/Online banking voucher references for Portuguese registrants.
- [ ] **[ES-PAY-01] Bizum Support**: Enable native Bizum payment method in Stripe Dashboard for Spanish customers (EUR).
- [ ] **[EU-PAY-01] SEPA Direct Debit**: Enable SEPA recurring bank debits for monthly/annual Iberian subscriptions.

### 2. Tax, Legal & EU Compliance
- [ ] **[TAX-01] NIF / CIF Input Validation**: Add 9-digit tax ID collection during onboarding & checkout (Portugal NIF, Spain CIF/NIF).
- [ ] **[TAX-02] Stripe Tax & EU Reverse Charge**: Configure automated VIES validation & B2B VAT exemption logic in Stripe.
- [ ] **[LEGAL-01] RGPD / GDPR Localization**: Add translated `Termos e Condições` / `Términos y Condiciones` and standard EU DPA agreements.
- [ ] **[LEGAL-02] EU AI Act Disclaimer**: Ensure web chat widget displays required AI identity disclosures (*Assistente Virtual IA / Asistente Virtual IA*).

### 3. AI Prompts & Dashboard Localization
- [ ] **[AI-PT-01] European Portuguese Prompt Engine**: Configure system prompt rules for European Portuguese (`pt-PT`) terminology and business etiquette.
- [ ] **[AI-ES-01] Spanish Prompt Engine**: Configure system prompt rules for Castilian Spanish (`es-ES`).
- [ ] **[LOC-01] Timezone Options**: Add `Europe/Lisbon` (UTC+0 / WEST UTC+1) and `Europe/Madrid` / `Atlantic/Canary` default timezone selection.

### 4. Telephony & Voice AI
- [ ] **[TEL-PT-01] +351 Portugal Number Provisioning**: Complete ANACOM regulatory address verification for local Portuguese numbers via Twilio/Vapi.
- [ ] **[TEL-ES-01] +34 Spain Number Provisioning**: Complete CNMC regulatory verification for local Spanish numbers via Twilio/Vapi.

---
*Created on 2026-08-20 for StyleFlo AI Expansion Roadmap.*
