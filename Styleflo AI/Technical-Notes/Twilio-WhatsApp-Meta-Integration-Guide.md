# StyleFlo AI — Twilio WhatsApp & Meta Integration Specification

**Role:** Senior Business Analyst & Solutions Architect  
**Project:** StyleFlo AI Omnichannel Expansion (WhatsApp Channel)  
**Date:** September 2026  
**Status:** Strategy & Requirements (No Code Phase)  
**Target Architecture:** Twilio Messaging API + Meta WhatsApp Business Platform (Cloud API)  

---

## Executive Summary

This document provides the definitive business analysis, regulatory roadmap, and technical integration requirements for enabling **two-way WhatsApp messaging** for StyleFlo AI tenants using **Twilio** and the **Meta WhatsApp Business Platform**.

While standard SMS and phone calls operate over public telecommunications networks (PSTN), WhatsApp operates as a **gated corporate ecosystem governed exclusively by Meta**. Enabling WhatsApp requires satisfying strict business identity verification, display name standards, conversation-based billing rules, and message-template governance.

---

## 1. The Core Ecosystem & Stakeholder Model

```
 ┌──────────────────────────────────────────────────────────┐
 │                     META PLATFORMS                       │
 │  - Meta Business Portfolio (Business Manager)            │
 │  - WhatsApp Business Account (WABA)                      │
 │  - Business Verification & Display Name Approval         │
 │  - Template Approvals & Quality Rating System            │
 └────────────────────────────┬─────────────────────────────┘
                              │ Official BSP Cloud API
 ┌────────────────────────────▼─────────────────────────────┐
 │                         TWILIO                           │
 │  - Meta Business Solution Provider (BSP)                 │
 │  - Twilio WhatsApp Senders (`whatsapp:+44...`)           │
 │  - Webhook Routing & Delivery Status Callbacks           │
 │  - Regulatory Compliance & Messaging API Engine          │
 └────────────────────────────┬─────────────────────────────┘
                              │ HTTPS Webhooks & REST API
 ┌────────────────────────────▼─────────────────────────────┐
 │                      STYLEFLO AI                         │
 │  - Multi-Tenant SaaS Platform                            │
 │  - Conversational AI Engine (Gemini 1.5/2.5)             │
 │  - Scheduling & Booking Automation System                │
 │  - 24-Hour Customer Window Tracking & Credit Allocation  │
 └────────────────────────────┬─────────────────────────────┘
                              │
 ┌────────────────────────────▼─────────────────────────────┐
 │                   SALONS & END CLIENTS                   │
 │  - Salon Owner (WhatsApp Business Profile)               │
 │  - Client / Customer (Standard WhatsApp App)             │
 └──────────────────────────────────────────────────────────┘
```

---

## 2. Meta Requirements & Prerequisites

Meta has strict gatekeepers before any business can send messages over the WhatsApp Business API.

### 2.1. Meta Business Portfolio (formerly Meta Business Manager)
- **Requirement:** StyleFlo (and potentially each salon, depending on multi-tenancy model) must have an active **Meta Business Portfolio** at [business.facebook.com](https://business.facebook.com).
- **Prerequisites:**
  - Valid corporate domain and official business email address (free webmail like `@gmail.com` is rejected).
  - An established Facebook user profile as the Portfolio Admin with Two-Factor Authentication (2FA) enabled.

### 2.2. Official Meta Business Verification
- **Why It Matters:** Without Business Verification, a WhatsApp Business Account (WABA) is severely restricted:
  - Limited to **250 unique business-initiated conversations** per rolling 24 hours.
  - Can only register up to **2 phone numbers**.
  - Cannot obtain an **Official Business Account (OBA)** green tick badge.
  - Senders may show with unverified display name warnings.
- **Documents Required by Meta:**
  1. **Legal Business Name Verification:** Certificate of Incorporation (e.g. UK Companies House), Business Registration Certificate, or Tax Registration (VAT).
  2. **Physical Address Verification:** Official utility bill (electricity, water), bank statement, or council tax bill matching the exact business legal name and address.
  3. **Domain & Email Verification:** DNS TXT verification record or verification code sent to the business email domain.

### 2.3. Display Name Rules & Branding Guidelines
- Meta reviews every sender's **Display Name** against strict criteria:
  - **Direct Correlation:** The display name must match the legal business name or public branding (e.g. website, signage, trademark).
  - **No Generic Terms:** Names like *"Salon AI"*, *"Haircuts"*, or *"London Spa"* will be immediately rejected. Must be distinct, e.g., *"Elegance Hair & Beauty"*.
  - **Grammar & Formatting:** Proper capitalization (no ALL CAPS, no emojis, no extra punctuation, no "WhatsApp" in the name).
  - **Public Footprint:** Meta reviewers will visit the website and social media to verify brand consistency.

### 2.4. Phone Number Requirements
- **Number Cleanliness:** The phone number used for WhatsApp **MUST NOT** be registered on a physical phone using the standard WhatsApp or WhatsApp Business mobile apps.
  - *Action:* If a salon is porting or using an existing number, they must first **delete their account** inside the WhatsApp mobile app (`Settings > Account > Delete my account`) before registering it with the API.
- **Number Types:** Twilio virtual UK Mobile numbers (`+44 7...`), Landline/Geographic numbers (`+44 1...` / `+44 2...`), or 03 non-geographic numbers can all be used, provided they can receive an automated SMS or voice phone call for one-time OTP verification.

---

## 3. Conversation Rules & Message Categories

WhatsApp differs fundamentally from SMS. Meta enforces a **24-hour Customer Service Window**:

```
 [ Customer Sends Message ]
            │
            ▼
 ┌────────────────────────────────────────────────────────┐
 │           24-HOUR CUSTOMER SERVICE WINDOW             │
 │                                                        │
 │  - Status: OPEN                                        │
 │  - Allowed Messages: FREE-FORM DYNAMIC TEXT & MEDIA    │
 │  - AI Agent: Free to converse, answer queries,         │
 │    quote prices, and book appointments via Gemini      │
 │  - Templates Required? NO                              │
 └────────────────────────────┬───────────────────────────┘
                              │
                    24 Hours Expire with
                     no customer reply
                              │
                              ▼
 ┌────────────────────────────────────────────────────────┐
 │           OUTSIDE CUSTOMER SERVICE WINDOW             │
 │                                                        │
 │  - Status: CLOSED                                      │
 │  - Allowed Messages: PRE-APPROVED TEMPLATES ONLY       │
 │  - AI Free-form Chat: BLOCKED BY META                  │
 │  - Allowed Categories: Utility, Marketing, Auth        │
 └────────────────────────────────────────────────────────┘
```

### 3.1. Message Categories Defined by Meta
1. **Service Conversations (User-Initiated):**
   - Triggered when a customer initiates contact (e.g. asking "Do you have availability tomorrow at 3pm?").
   - StyleFlo's AI chatbot can converse continuously for 24 hours from the customer's last message without templates.
2. **Utility Conversations (Business-Initiated):**
   - Pre-approved templates regarding an existing transaction or appointment.
   - *Examples:* Appointment booking confirmations, 24-hour reminder notifications, rescheduling alerts, cancellation receipts.
3. **Marketing Conversations (Business-Initiated):**
   - Promotional announcements, re-engagement offers ("We haven't seen you in 6 weeks! Here is 10% off"), seasonal specials.
   - Requires explicit opt-in; subject to higher Meta conversation charges.
4. **Authentication Conversations:**
   - One-time verification passcodes (OTP).

### 3.2. Meta Template Approval Process
- Any message sent outside the 24-hour window **MUST** use a pre-approved template.
- Templates must be submitted via the Twilio Console or Twilio Content API and reviewed by Meta's automated AI + human review (typically approved in 2 minutes to 24 hours).
- **Template Structure:**
  - Header: Optional text or media (image/document).
  - Body: Plain text with variable parameters (`{{1}}`, `{{2}}`).
    - *Example:* `Hi {{1}}, this is a reminder for your appointment at {{2}} on {{3}} with {{4}}. Reply YES to confirm or RESCHEDULE to change.`
  - Footer: Short disclaimer (e.g. `Reply STOP to opt out`).
  - Buttons: Quick Reply buttons (`Confirm`, `Cancel`) or Call-to-Action buttons (`Visit Website`, `Call Salon`).

---

## 4. Multi-Tenancy Architecture Options for StyleFlo

Because StyleFlo is a multi-tenant B2B SaaS serving hundreds of independent salons, we must choose the appropriate multi-tenancy model:

| Dimension | Model A: StyleFlo Managed Master WABA (Recommended for Launch) | Model B: Twilio Embedded Signup (Meta ISV / Tech Provider) |
| :--- | :--- | :--- |
| **How it works** | StyleFlo owns a single master Meta Business Portfolio and master Twilio WABA. Each salon's provisioned Twilio number is added as an individual **Sender Profile** under StyleFlo's account. | Each salon connects their own Meta Business Manager via an embedded Facebook login popup in the StyleFlo dashboard, granting StyleFlo partner management rights. |
| **User Experience** | **Zero-effort for salon:** Salon buys the £9.99/mo or £19.99/mo WhatsApp bolt-on in Stripe; StyleFlo automatically registers the sender. Salon never deals with Meta or Facebook. | **High friction:** Salon owners must log into Meta Business Manager, upload company proof, and navigate Meta permissions. |
| **Display Name** | The sender display name can be customized to the salon's name (e.g. *"The Hair Loft by StyleFlo"* or *"The Hair Loft"*), but requires Meta proof submitted by StyleFlo. | Salon controls their exact legal display name and can achieve their own green checkmark. |
| **Speed to Market** | **Fast (1-2 weeks):** Single integration with Twilio's Messaging API. | **Complex (4-8 weeks):** Requires Meta Tech Provider approval, OAuth login dialog, and WABA webhooks. |
| **Recommended Verdict** | **Stage 1 (Launch & MVP):** Deploy Model A for all provisioned mobile/landline numbers. | **Stage 2 (Enterprise):** Offer Model B for large franchise chains that demand their existing WABA. |

---

## 5. Commercials & Cost Structure (Meta + Twilio)

Understanding the cost model is critical for the profitability of StyleFlo's £9.99/mo and £19.99/mo WhatsApp bolt-ons:

### 5.1. Meta Conversation Charges (UK Rates - Approx.)
Meta charges per **24-hour conversation window** (not per message):
- **User-Initiated (Service):** Free allowance for the first 1,000 service conversations per month across the WABA. Subsequent service conversations cost ~**£0.027** per 24h window.
- **Business-Initiated (Utility):** ~**£0.015 - £0.020** per conversation.
- **Business-Initiated (Marketing):** ~**£0.045 - £0.060** per conversation.

### 5.2. Twilio Carrier Markup
- Twilio charges a platform fee per message segment:
  - Outbound/Inbound WhatsApp Message: ~**$0.005** (approx. **£0.004**) per message.
- Monthly phone number rental: Included in the existing StyleFlo Mobile (£10.99) or Landline (£8.99) bolt-on.

### 5.3. Margin Protection for StyleFlo
- StyleFlo's **500 messages/month** allowance on the WhatsApp bolt-on comfortably covers an average salon's usage:
  - 500 messages ≈ 50-100 two-way client conversations per month.
  - Typical wholesale cost to StyleFlo: £2.50 - £4.50.
  - Retail bolt-on price: £9.99/mo (add-on) or £19.99/mo (standalone).
  - **Gross Margin: 55% - 75%**.

---

## 6. End-to-End Step-by-Step Implementation Roadmap

```
PHASE 1: Meta Foundation
  ├── Step 1.1: Verify StyleFlo Meta Business Portfolio
  └── Step 1.2: Complete Meta Business Verification

PHASE 2: Twilio WhatsApp Senders Enablement
  ├── Step 2.1: Request WhatsApp Access in Twilio Console
  ├── Step 2.2: Link StyleFlo Meta Business Manager ID with Twilio
  └── Step 2.3: Register Twilio Sandbox for QA Testing

PHASE 3: Regulatory & Sender Submission Process
  ├── Step 3.1: Twilio WhatsApp Sender Registration
  ├── Step 3.2: Meta Display Name Approval
  └── Step 3.3: Two-Factor OTP Verification on Selected Number

PHASE 4: Inbound & Outbound Webhook Architecture
  ├── Step 4.1: Configure Inbound Webhook Endpoint
  ├── Step 4.2: Session Identifier & 24h Window Tracking
  └── Step 4.3: Gemini Context Injection for WhatsApp

PHASE 5: Outbound Template Governance
  ├── Step 5.1: Create Standardized Appointment Utility Templates
  └── Step 5.2: Twilio Content API Submission & Verification

PHASE 6: Tenant Dashboard & UX
  ├── Step 6.1: Dedicated WhatsApp Management View
  ├── Step 6.2: QR Code & "Click-to-Chat" Web Links
  └── Step 6.3: Compliance & Opt-in Tracking
```

---

### Step-by-Step Breakdown

#### Step 1: Meta Business Portfolio Verification
1. Log into [Meta Business Settings](https://business.facebook.com/settings).
2. Go to **Security Center > Business Verification**.
3. Submit official registration documents (UK Companies House Certificate and Utility bill).
4. Verify corporate email via domain authentication.
5. Note down the **15-digit Meta Business Manager ID** (needed for Twilio).

#### Step 2: Twilio Account Association
1. Log into the master [Twilio Console](https://console.twilio.com).
2. Navigate to **Messaging > Senders > WhatsApp Senders**.
3. Link the Twilio Account with StyleFlo's Meta Business Manager ID.
4. Accept Meta's terms of service granting Twilio permission to manage WhatsApp messaging on your behalf.

#### Step 3: Registering a Phone Number as a WhatsApp Sender
1. Select a provisioned phone number (e.g. a Twilio UK mobile `+44 7...`).
2. Submit a **Sender Request** with:
   - **Phone Number:** E.164 format (`+447xxxxxxxxx`).
   - **Display Name:** The official name of the salon (e.g. *"StyleFlo Salon"*).
   - **Category:** Beauty, Cosmetic & Personal Care.
   - **Website & Description:** Salon website URL and business bio.
3. Meta reviews and approves the Display Name (typically within 4–24 hours).
4. Twilio triggers an automated SMS or voice call OTP to verify ownership of the number.

#### Step 4: System Webhook Architecture (StyleFlo Backend)
1. In Twilio Console, configure the WhatsApp Sender's webhook URL:
   `https://app.styleflo.ai/api/telephony/whatsapp/inbound`
2. **Inbound Message Handling:**
   - Twilio posts `From: whatsapp:+447123456789`, `To: whatsapp:+447987654321`, `Body: Hi!`.
   - StyleFlo backend maps `To` (`whatsapp:+447987654321`) to the tenant's chatbot via `public.chatbots.whatsapp_phone_number` or `tenants.twilio_mobile_number`.
   - Store conversation in `public.conversations` with `channel = 'whatsapp'`.
   - Stream or generate reply using Gemini AI model with salon knowledge base.
   - Reply back to Twilio using TwiML (`<Response><Message>...</Message></Response>`) or REST API.

#### Step 5: Appointment Notification Templates (Outbound)
1. Draft standardized utility templates for salons:
   - **Template: `appointment_confirmation`**
     > *"Hi {{1}}, your appointment for {{2}} at {{3}} is confirmed with {{4}} on {{5}} at {{6}}. Reply CANCEL to change."*
   - **Template: `appointment_reminder_24h`**
     > *"Hi {{1}}, this is a friendly reminder for your upcoming appointment tomorrow at {{2}} with {{3}}. We look forward to seeing you!"*
2. Submit templates through Twilio's Content API or Twilio Console.
3. Once approved, StyleFlo's scheduling cron can dispatch these templates to clients programmatically outside the 24-hour window.

#### Step 6: Tenant Dashboard Experience & Marketing Tools
1. **WhatsApp Status Widget:** Inside `app.styleflo.ai/dashboard`, show active status, allocated monthly message count, and remaining quota.
2. **Click-to-Chat QR Codes & Links:**
   - Generate instant `https://wa.me/447xxxxxxxxx?text=Hi!%20I%20would%20like%20to%20book%20an%20appointment` links.
   - Provide printable SVG/PDF QR codes for the salon front counter or window display ("Scan to book on WhatsApp").
3. **Opt-In Protection:** Ensure web widgets and booking checkout forms include a checkbox: *"Receive booking updates and reminders via WhatsApp."*

---

## 7. Immediate Action Checklist (What to Do Next)

Before writing any software code, the business operations team must complete the following 5 tasks:

- [ ] **Task 1 (Meta):** Check [business.facebook.com](https://business.facebook.com) to verify if StyleFlo's Meta Business Manager is already created and if Business Verification is complete.
- [ ] **Task 2 (Meta):** Gather Companies House registration document and utility bill for StyleFlo's legal entity if verification is pending.
- [ ] **Task 3 (Twilio):** Open the [Twilio WhatsApp Console](https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders) and verify the account's WhatsApp status.
- [ ] **Task 4 (Twilio):** Test the **Twilio WhatsApp Sandbox** using a personal mobile to experience the developer messaging loop firsthand.
- [ ] **Task 5 (Policy):** Review the official [WhatsApp Commerce Policy](https://www.whatsapp.com/legal/commerce-policy/) to verify compliance across all planned salon services.

---

*Report prepared for StyleFlo AI Executive Management.*  
*Next Phase:* Technical Architecture & Endpoint Specification upon completion of Meta verification prerequisites.
