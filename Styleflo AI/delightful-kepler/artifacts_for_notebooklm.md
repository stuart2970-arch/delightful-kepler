

# create_appointments_table.md


-- Create appointments table
CREATE TABLE public.appointments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
    service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
    customer_name text NOT NULL,
    customer_email text NOT NULL,
    customer_phone text,
    start_time timestamptz NOT NULL,
    end_time timestamptz NOT NULL,
    google_event_id text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;

-- Add RLS policies
CREATE POLICY select_appointments ON public.appointments FOR SELECT TO authenticated USING (tenant_id = public.get_auth_tenant_id());
CREATE POLICY insert_appointments ON public.appointments FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY update_appointments ON public.appointments FOR UPDATE TO authenticated USING (tenant_id = public.get_auth_tenant_id()) WITH CHECK (tenant_id = public.get_auth_tenant_id());
CREATE POLICY delete_appointments ON public.appointments FOR DELETE TO authenticated USING (tenant_id = public.get_auth_tenant_id());


# dashboard_ui_plan.md


# Dashboard UI for Scheduling Configuration

This document outlines the proposed UI implementation for the "Services & Staff" settings page in the dashboard.

## User Review Required
> [!IMPORTANT]
> **Dashboard Integration**: I propose adding a new "Scheduling" tab to the main StyleFlo Dashboard. This will sit alongside "Chatbots Manager" and "Conversation Logs". 

## Proposed Changes

### 1. New "Scheduling" Tab in DashboardClient
#### [MODIFY] `src/components/DashboardClient.tsx`
- Add a new tab `scheduling` to the tab navigation bar.
- Create the content for the `scheduling` tab which will include:
  1. **Google Calendar Connection Status**: A button to trigger the OAuth flow (`/api/integrations/google/authorize?tenantId=...`).
  2. **Services List**: A section to list, add, and edit services (Name, Duration, Buffer).
  3. **Staff List**: A section to list, add, and edit staff members (Name, Email, Working Days, Google Calendar ID).

### 2. API Routes for CRUD Operations
We need backend routes to support the Dashboard UI for fetching and updating the configuration.
#### [NEW] `src/app/api/services/route.ts`
- GET/POST/PUT/DELETE for Services.
#### [NEW] `src/app/api/staff/route.ts`
- GET/POST/PUT/DELETE for Staff.
#### [NEW] `src/app/api/integrations/google/status/route.ts`
- A quick route to check if the tenant has a valid refresh token on file.

## Verification Plan
### Manual Verification
1. Open the Dashboard and click the "Scheduling" tab.
2. Verify that clicking "Connect Google Calendar" redirects to Google OAuth and returns successfully.
3. Add a Service (e.g. "Haircut - 30m").
4. Add a Staff member (e.g. "John Doe") with specific working hours.
5. Ensure data persists across page reloads.


# implementation_plan.md


# Goal: Professional UX/UI Dashboard Redesign

The current dashboard is functional but relies on a standard "developer-centric" layout (simple horizontal tabs, basic dark containers). To make it a **premium B2B SaaS dashboard** that wows salon owners, I will overhaul the entire layout and visual language.

## Design Aesthetic (Dark Mode Premium)
- **Glassmorphism**: We will use translucent panels with blurred backgrounds (`backdrop-blur-xl bg-gray-900/40`) to create depth.
- **Accents**: Subtle, rich gradient meshes in the background (e.g., deep violet and midnight blue) to break up the flat black.
- **Typography**: Utilizing the modern Geist font already in the app, but enforcing better visual hierarchy (softer grays for subtitles, sharp white for primary metrics, tracked-out caps for micro-labels).
- **Micro-animations**: Smooth hover transitions on cards, buttons, and inputs.

## Proposed Architectural Changes

### 1. The App Shell (Sidebar Navigation)
Horizontal tabs do not scale well and feel outdated. We will refactor `DashboardClient.tsx` to use a **Left Sidebar Architecture**.
- **Sidebar**: Will contain navigation links (Chatbots, Scheduler, Knowledge Base, Logs, Integrations) accompanied by modern SVG icons.
- **Header**: A clean top header showing the current active module, a greeting, and the user profile/tenant details.
- **Main Content Area**: A scrollable canvas with a subtle gradient background where the active view renders.

### 2. Component Makeovers
We will systematically go through the views inside `DashboardClient.tsx` and upgrade their CSS:
- **Metrics Bar**: Elevate the 4 statistic blocks to look like glowing, premium metric cards.
- **Forms & Inputs**: Replace blocky inputs with sleek `rounded-xl` inputs featuring focus rings (`focus:ring-indigo-500/50`) and soft internal shadows.
- **Toggle Cards (Booking Modes & Integrations)**: Convert the radio buttons into clickable, active-state cards with borders that illuminate when selected.

### 3. File Refactoring Strategy
Currently, `DashboardClient.tsx` is roughly 1,700 lines of code. 
- **Immediate Visual Overhaul**: I will inject the new Sidebar layout and overarching CSS structure directly into `DashboardClient.tsx` to completely transform the look and feel immediately.
- **Future-proofing (Optional)**: If desired, I can begin splitting the massive `DashboardClient` into smaller files (e.g., `Sidebar.tsx`, `ChatbotTab.tsx`, `SchedulingTab.tsx`) but for safety and speed on this first pass, applying the CSS classes and structure in-place is the safest way to guarantee nothing breaks.

> [!WARNING]
> Because this is a major visual rewrite of the primary dashboard file, the layout will look radically different (and much better) after this. 

> [!TIP]
> Are you ready for me to execute this UI overhaul? Click **Proceed** to authorize the redesign!


# multi_week_schedule_plan.md


# Multi-Week Date-Specific Schedule Plan

This document outlines the proposed changes to upgrade the staff schedule from a "recurring weekly template" to a "date-specific, multi-week rolling schedule" based on your latest requirements.

## Open Questions

> [!WARNING]
> **1. Rolling Schedule vs. Fixed Rota:**
> If you configure a schedule for the next 4 weeks (e.g., July 6 to Aug 2), what happens when a week passes? Do you plan to manually log in every week to add the *new* 4th week? Or should we allow configuring a "Default/Recurring Week" that the AI falls back to when a specific week's rota hasn't been set yet?
> 
> **2. Copying behavior:**
> When clicking "Copy this rota to next week", should it copy the *exact dates* (obviously impossible, it will shift dates forward by 7 days), or just copy the AM/PM times from Week 1's Monday to Week 2's Monday?

## Proposed JSON Structure
The `working_days` JSON object saved in the database will be updated from a single week object to an array of specific weeks:

```json
{
  "weeks": [
    {
      "weekCommencingDate": "2026-07-06",
      "monday": { "unavailable": false, "am": { "start": "09:00", "end": "12:00" }, "pm": null },
      "tuesday": { "unavailable": true, "am": null, "pm": null }
      // ...
    }
    // ... up to 4 weeks
  ]
}
```

## Proposed Changes

### 1. Dashboard UI Updates
#### [MODIFY] `src/components/DashboardClient.tsx`
- **Tabbed Weeks UI:** To avoid a massive vertical scroll, I will add small tabs (Week 1, Week 2, Week 3, Week 4) above the grid.
- **Week Commencing Date:** Each week will have a date picker at the top to select the "Week Commencing" (Monday's date). This date will automatically populate the dates for the rest of the week's rows.
- **Unavailable Tickbox:** Add a checkbox column. Ticking it will disable the time inputs and clear the schedule for that specific day.
- **Copy Button:** Move the copy button to the bottom and change it to "Copy this rota to next week". When clicked, it will copy the times to the next tab and automatically increment the "Week Commencing" date by 7 days.

### 2. Backend & AI Availability Algorithm
#### [MODIFY] `src/app/api/chat/stream/calendar.ts`
- Completely rewrite the availability checker.
- When checking a requested date (e.g., "next Tuesday"), the AI will first determine which "Week Commencing" block that date falls under.
- If it finds a matching week in the JSON, it will use those specific AM/PM times (or see if the "Unavailable" box is ticked).
- If it *cannot* find a matching week block for the requested date, it will assume the staff member is unavailable, or fallback to the most recent week's config (based on your answer to Question 1).

## Verification Plan
1. Open the dashboard and test adding a staff member.
2. Select a Week Commencing date, set up Week 1, and click "Copy to next week". Verify Week 2 populates correctly with dates shifted by +7 days.
3. Check "Unavailable" for Wednesday and verify the inputs clear.
4. Test the AI booking to ensure it respects the specific date-based weeks and ignores the unavailable days.


# notebooklm_summary.md


# StyleFlo (Delightful Kepler) - Project Architecture & Development Summary

This document provides a comprehensive overview of the architecture, features, and technical hurdles resolved during the development of **StyleFlo**, a highly scalable, multi-tenant AI customer support chatbot platform.

## 🏗️ Core Technology Stack
* **Frontend**: Next.js 15 (App Router), React, Tailwind CSS (v3 for dashboard, v2 CDN for embedded widget).
* **Backend**: Next.js Serverless API Routes deployed on Vercel.
* **Database**: Supabase (PostgreSQL) with `pgvector` extension for storing and querying high-dimensional vector embeddings.
* **AI & LLMs**: 
  * **Vercel AI SDK** for managing fluid, real-time token streaming.
  * **Google Gemini (`gemini-3.5-flash`)** as the primary conversational brain.
  * **Google Gemini (`gemini-embedding-001`)** for converting text into 768-dimensional semantic vectors.

---

## ✨ Key Features & Systems Built

### 1. Multi-Tenant Dashboard
We built a centralized React dashboard allowing administrators to manage multiple distinct AI assistants (e.g., the default bot and custom bots like "Angel"). 
* **Dynamic Customization**: Admins can customize the chatbot's name, role, avatar, primary brand color, and default welcome message. 
* **Real-time Sync**: Configurations are saved to Supabase as JSON objects and instantly reflect on the live embeddable widget via a secure API.

### 2. Intelligent Web Crawler & Ingestion Pipeline
To feed the AI's "brain" with specific company knowledge, we constructed a custom RAG (Retrieval-Augmented Generation) ingestion pipeline.
* **Batch URL Processing**: The dashboard console was upgraded to accept bulk lists of URLs (separated by spaces, newlines, or commas). It processes these sequentially to respect serverless timeout limits.
* **Server-side Scraping**: The `/api/ingest/crawl` endpoint uses `Cheerio` to securely fetch and clean HTML directly on the server, bypassing strict browser CORS protections.
* **Vector Embeddings**: Raw text is chunked into 1,000-character blocks using `LangChain`, converted into embeddings via Gemini, and inserted into a Supabase `pgvector` table (`document_chunks`).

### 3. Retrieval-Augmented Generation (RAG) Engine
When a user asks the widget a question, the system doesn't rely purely on the LLM's baseline training. 
* It converts the user's query into an embedding.
* It executes a cosine similarity search via a custom Supabase RPC (`match_document_chunks`).
* It injects the top 5 most relevant business facts into the hidden System Prompt before streaming the answer back to the user, ensuring the AI only answers using factual, company-approved data.

### 4. Resilient Streaming Architecture
Streaming AI responses is notoriously fragile. We spent significant time bulletproofing the streaming pipeline.
* **Model Upgrades**: We successfully migrated the backend from deprecated older models up to Google's latest `gemini-3.5-flash` model.
* **Error Interception**: We engineered a custom `ReadableStream` wrapper. Instead of the Vercel AI SDK failing silently and leaving the user staring at a "blank bubble" when API errors occur, our wrapper catches fatal HTTP errors and streams them directly into the chat interface (e.g., `[STREAM ERROR: 404]`), vastly improving debugging and transparency.
* **Humanized Persona**: The System Prompt was heavily engineered to force the AI to act as a warm, friendly, conversational human support agent who uses occasional emojis and avoids overwhelming "walls of text."

### 5. The Embeddable Shadow DOM Widget
To allow clients (like hair salons) to install the chatbot on their existing websites with zero friction, we built a standalone `widget.js` script.
* **Shadow DOM Isolation**: The entire widget UI is encapsulated inside a Shadow DOM. This guarantees that the host website's CSS will never break the chatbot's design, and the chatbot's Tailwind CSS will never leak out and break the host website.
* **Responsive Layouts**: Fixed major mobile/desktop scaling issues. The widget now uses standard CSS fallback rules to render a perfectly constrained 380px floating card on desktop (preventing horizontal scrollbar bleeding) while smoothly adapting to mobile screens.
* **Rich Text Parsing**: Built a lightweight Markdown parser directly into the vanilla JS widget so the AI's bold text (`**bold**`) and line breaks render as beautifully formatted HTML on the client's screen.
* **CORS Compliance**: Engineered the `/api/chatbots/[id]` configuration endpoint with proper `OPTIONS` preflight handlers and wildcard CORS headers so the widget can securely fetch dynamic branding assets across different domains.


# pricing_strategy.md


# StyleFlo Pricing Strategy Proposal

This document outlines a proposed 4-tier SaaS pricing model for the StyleFlo AI Chatbot. The goal is to provide a clear upgrade path that incentivizes businesses to move to higher tiers as they scale and require more advanced automation.

## 💰 Proposed Pricing Tiers

Here is a realistic breakdown of how to distribute features across **Basic**, **Starter**, **Premium**, and **Ultimate**.

### 1. Basic (Free Tier)
**Target Audience:** Solo founders, hobby sites, or businesses just testing the AI capabilities.
* **Metric Limit:** 50 Sessions/mo
* **Web Crawling:** Up to 10 pages indexed
* **Lead Capture:** Basic Email Capture (No automatic CRM integrations)
* **Customization:** Standard StyleFlo branding on the widget
* **Support:** Community/Email support only

### 2. Starter (e.g., $29 - $39/mo)
**Target Audience:** Small service businesses (plumbers, salons, consultants) that need reliable booking and support.
* **Metric Limit:** 250 Sessions/mo
* **Web Crawling:** Up to 100 pages indexed + PDF uploads
* **Calendar Integration 🗓️:** AI can autonomously check availability and book meetings directly into Google Calendar (Huge selling point moved down to the Starter tier!).
* **Lead Capture:** Zapier/Webhook integrations to their CRM
* **Customization:** Remove branding; Custom colors

### 3. Premium (e.g., $79 - $99/mo)
**Target Audience:** Scaling e-commerce brands and agencies relying heavily on lead generation and advanced interactions.
* **Metric Limit:** 1,000 Sessions/mo
* **Voice AI Integration 🎙️:** Users can tap a microphone to speak, and the AI replies with natural voice.
* **Human Handoff (Basic) 🤝:** Ability to instantly notify the store owner if the AI can't answer, allowing them to reply via email.
* **Web Crawling:** Up to 1,000 pages (daily re-crawling)

### 4. Ultimate / Enterprise (e.g., $199 - $299+/mo)
**Target Audience:** High-volume customer support teams or luxury brands needing state-of-the-art omnichannel interactions.
* **Metric Limit:** Unlimited (or custom volume)
* **Live Human Handoff 🤝:** Seamless escalation to a live human agent via Slack/Teams.
* **Omnichannel:** Deploy to WhatsApp, Instagram DMs, and Facebook Messenger.
* **Web Crawling:** Real-time API integrations.

---

## 📊 Messages vs. Sessions: Explaining the Difference

When deciding how to charge users for their chatbot usage, you have two main options:

1. **Messages Per Month:** 
   * **How it works:** You count every single individual message the user sends to the chatbot. If a user says "Hi", then "Do you have blue bags?", then "Thanks", that counts as 3 messages.
   * **Pros:** Exactly correlates to your underlying API costs (since you pay Google per request).
   * **Cons:** It discourages users from having natural, long conversations with the AI because business owners might worry about hitting their cap too quickly.

2. **Active Sessions (Recommended):**
   * **How it works:** A "Session" is a single conversation thread. Whether a customer asks 1 question or 20 questions during their visit to the website, it only counts as 1 Session.
   * **Pros:** Highly predictable for the business owner. If they get 500 visitors a month, they know exactly which tier they need. It encourages long, engaging conversations that lead to better sales conversions.
   * **Cons:** Occasionally, a user might send 50 messages in one session, costing you slightly more API credits for that specific chat. (But Google Gemini 3.5 Flash is so incredibly cheap that this won't realistically hurt your margins!).

> [!TIP]
> **Recommendation:** Switch to a **Session-based** pricing model. It is significantly easier to market to small business owners because it translates directly to "Customer Conversations."

---

## 🚀 Next Steps for Development

Based on your priorities, the roadmap for advanced features is:
1. **Google Calendar Integration:** (Highest priority - moving this to the highly accessible Starter tier will drive massive conversions).
2. **Voice AI:** (Moved to Premium).
3. **Human Handoff:** (Basic email handoff in Premium, real-time live chat handoff reserved for Ultimate).

---

## 🔍 Feature Matrix Overview

| Feature | Basic | Starter | Premium | Ultimate |
| :--- | :---: | :---: | :---: | :---: |
| **Message Limits** | 1,000 / mo | 5,000 / mo | 15,000 / mo | Unlimited |
| **Data Sources** | 10 Pages | 100 Pages | 1,000 Pages | Real-time APIs |
| **Lead Capture** | Email Only | CRM Sync / Zapier | Native Integrations | Advanced Routing |
| **White-Labeling** | ❌ | ✅ | ✅ | ✅ |
| **Human Handoff** | ❌ | Email Notification | Live Agent Takeover | Dedicated Routing |
| **Calendar Booking** | ❌ | ❌ | ✅ | ✅ |
| **Voice AI** | ❌ | ❌ | ❌ | ✅ |
| **Omnichannel (WhatsApp)** | ❌ | ❌ | ❌ | ✅ |

> [!TIP]
> **Why this structure works:** Calendar integrations and live-human handoffs are massive time-savers for businesses, making them perfect features to lock behind the **Premium** tier. Voice AI and Omnichannel (WhatsApp/Instagram) are complex and expensive to run, making them ideal for the highly profitable **Ultimate** tier.

---

## 🙋 Open Questions for You

1. **Pricing Metrics:** Do you want to base limits strictly on "Messages per month", or would you rather limit by "Active Chatbot Sessions / Conversations"?
2. **Current Priorities:** Out of the advanced features (Calendar, Human Handoff, Voice), which one are you most interested in building out first?
3. **Price Points:** Do the suggested price points align with what you believe your target demographic is willing to pay?


# staff_schedule_plan.md


# Spreadsheet-Style Staff Schedule UI

This document outlines the plan to build the requested spreadsheet-style schedule editor for staff members, and to wire that schedule into the AI's availability checking algorithm.

## User Review Required
> [!IMPORTANT]
> To support the "AM" and "PM" shifts shown in your spreadsheet, the staff schedule will be stored as a structured JSON object. The AI will read this exact schedule to determine the boundaries of a staff member's working day, meaning the AI will never book an appointment outside of these configured shifts, or during their mid-day break (the gap between AM and PM).

## Proposed Changes

### 1. Dashboard UI Updates
#### [MODIFY] `src/components/DashboardClient.tsx`
- Expand the "Add Staff Member" modal to be wider and include a spreadsheet-like grid.
- The grid will have rows for each day of the week (Monday - Sunday).
- The grid will have 4 time inputs per row: `AM Start`, `AM Finish`, `PM Start`, `PM Finish`.
- Include a "Copy from last week" / "Copy to all days" button for quick data entry.
- Store this schedule grid as a JSON object in the `working_days` field of the staff member.

### 2. Backend Storage & Validation
#### [MODIFY] `src/app/api/staff/route.ts`
- Ensure the `POST` and `PUT` routes accept and validate the complex `working_days` JSON payload.

### 3. AI Calendar Availability Algorithm
#### [MODIFY] `src/app/api/chat/stream/calendar.ts`
- Update the `checkAvailability` algorithm. It currently uses a hard-coded 9 AM to 5 PM (Mon-Fri) block.
- Modify it to fetch the specific staff member's `working_days` JSON config.
- When finding available slots, the algorithm will now strictly adhere to the specific AM and PM shift boundaries for that particular day of the week, automatically skipping their break.

## Verification Plan
1. Open the dashboard and verify the new grid UI matches the spreadsheet mockup.
2. Add a staff member with a split shift (e.g. 09:00-12:00 and 13:00-17:00).
3. Chat with the AI and request an appointment. Verify the AI does not offer times during the 12:00-13:00 break or outside the scheduled shifts.


# staff_services_migration.sql.md


# SQL Migration: Staff-Services

Please copy the SQL code below exactly as it appears in the code block and run it in your Supabase SQL Editor:

```sql
-- 1. Create the staff_services junction table
CREATE TABLE public.staff_services (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  service_id UUID NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  custom_price DECIMAL(10, 2) NULL,
  custom_duration INTEGER NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(staff_id, service_id)
);

-- 2. Enable Row Level Security (RLS)
ALTER TABLE public.staff_services ENABLE ROW LEVEL SECURITY;

-- 3. Add RLS Policies
CREATE POLICY "Allow public read access for staff_services"
  ON public.staff_services FOR SELECT
  USING (true);

CREATE POLICY "Allow authenticated users to manage staff_services"
  ON public.staff_services FOR ALL
  USING (auth.role() = 'authenticated');
```


# staff_service_mapping_plan.md


# Staff-Service Specialization & Tiered Pricing

This document outlines the product use cases and technical implementation strategy for handling complex relationships between staff members and the services they provide, including variable pricing and durations based on seniority or specialization.

---

## 1. Product Owner Perspective: Use Cases

As a product owner, mapping out real-world eventualities ensures the platform is flexible enough to accommodate diverse business models (e.g., salons, law firms, clinics).

### Use Case A: Service Specialization (The "Who does what?")
**Scenario:** A beauty salon offers basic haircuts and complex balayage coloring. Junior stylist "Sarah" only does haircuts. Senior colorist "Michael" does both.
**User Story:** As a customer, if I ask the AI to book a "Balayage", the AI should only check Michael's availability and offer his times. It should not mistakenly book me with Sarah.

### Use Case B: Tiered Pricing by Seniority (The "Experience Premium")
**Scenario:** A law firm offers a "1-hour Initial Consultation" with a base price of $100. However, booking the Senior Partner, "Jessica", costs $250.
**User Story:** As a customer, if I want to book the Senior Partner, the AI must accurately quote me $250 before I confirm the booking, ensuring there are no surprises when it comes to billing. 

### Use Case C: Variable Durations (The "Efficiency Factor")
**Scenario:** A massage clinic offers a "Deep Tissue Massage". An experienced therapist can complete the standard protocol in 45 minutes, while an apprentice requires 60 minutes.
**User Story:** As a business owner, I want the system to block out 45 minutes on the senior therapist's calendar, but 60 minutes on the apprentice's calendar, maximizing my senior therapist's daily booking capacity.

### Use Case D: AI Upselling & Preference Routing
**Scenario:** A customer asks, "Can I book a haircut for tomorrow?"
**User Story:** The AI should intelligently respond: "I have openings tomorrow! Would you prefer our Junior Stylist Sarah (from $50) or our Senior Director Michael (from $80)?"

---

## 2. Developer Perspective: Technical Implementation

To bring these use cases to life without overcomplicating the database structure, we will implement a flexible many-to-many relationship using Supabase and update our AI logic to handle the multi-dimensional queries.

### 2.1 Database Architecture
We will introduce a new junction table in Supabase called `staff_services`.

**Table: `staff_services`**
- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Foreign Key)
- `staff_id` (UUID, Foreign Key -> staff table)
- `service_id` (UUID, Foreign Key -> services table)
- `custom_price` (Decimal, Nullable) - *Overrides the base service price if set.*
- `custom_duration` (Int, Nullable) - *Overrides the base service duration if set.*

*Why this approach?* A junction table is the standard SQL way to handle many-to-many relationships. It allows us to easily query "Which staff can do X?" and "What services does Staff Y do?" while cleanly storing the custom pricing overrides.

### 2.2 Dashboard UI / Frontend
We will update the Dashboard to allow business owners to configure this mapping easily:

1. **Service Configuration Modal:**
   - When editing a Service (e.g., "Haircut"), we will add a new section: **"Assigned Staff"**.
   - It will display a checklist of all configured staff members.
   - If a staff member is checked, two optional input fields will appear next to their name: `Price Override ($)` and `Duration Override (mins)`.
2. **Staff Configuration Modal:**
   - (Optional/Phase 2) Conversely, when editing a Staff Member, we can show a checklist of "Supported Services" so the owner can configure the mapping from either side of the dashboard.

### 2.3 Backend / API Route Updates
- **Services API (`/api/services`):** Update the `GET` route to perform a SQL `JOIN` on `staff_services`. The returned service objects will include an array of `assigned_staff` containing their IDs, names, and custom prices/durations.
- **Save Logic:** Update the `POST`/`PUT` routes to insert/update/delete rows in the `staff_services` junction table whenever a service is saved in the dashboard.

### 2.4 AI Algorithm Updates (The Brains)
The `src/app/api/chat/stream/route.ts` and `calendar.ts` files will require the most critical updates:

1. **Context Enrichment:** When the AI reads the `services` list from the database, it will now see the `assigned_staff` array. The AI System Prompt will be updated to instruct the LLM: *"When a user asks for a service, you must cross-reference which staff provide it and quote their specific price."*
2. **Availability Filtering:** The `checkAvailability` tool will be updated to accept an optional `serviceId`.
   - If a customer asks "When is anyone available for a Balayage?", the tool will automatically filter out any staff who do not have a mapping to the "Balayage" `serviceId`.
3. **Dynamic Duration:** The `checkAvailability` calendar loop will check if the specific staff member has a `custom_duration` for that service. If yes, it steps through their calendar in chunks of `custom_duration`, rather than the generic base duration.

### Next Steps & Feedback
This architecture provides total flexibility for both simple businesses (everyone does everything for the same price) and complex businesses (tiered pricing, specialists). 

**Question for you:** Would you like to proceed with implementing this architecture now, or would you prefer we first implement the Stripe Subscription Paywall tiers for the platform itself before diving deeper into the booking complexity?


# staff_update_plan.md


# Implementation Plan: Update Staff Functionality

This plan details the steps to add the ability to edit existing staff members and update their 4-week schedules.

## Proposed Changes

### 1. Backend API Updates
#### [MODIFY] `src/app/api/staff/route.ts`
- Add a new `PUT` method to handle updating an existing staff member.
- The route will accept the `id`, `name`, `email`, `google_calendar_id`, and the updated `working_days` (the 4-week JSON structure).
- It will execute a Supabase `update` query matched on the staff `id` and `tenant_id`.

### 2. Dashboard UI Updates
#### [MODIFY] `src/components/DashboardClient.tsx`
- **State Changes:** 
  - Change `showAddStaff` to a more generic `showStaffModal` boolean.
  - Add `editingStaffId` state to track if we are creating new staff or updating an existing one.
- **Form Population:** Create a function `openEditStaff(staff)` that sets the form states (`newStaffName`, `newStaffEmail`, etc.) and pre-fills `newStaffSchedule` with their existing `working_days` JSON config. If a week object is missing from their DB config, it will gracefully fall back to an empty schedule for that tab.
- **UI Tweaks:** 
  - Add an "Edit" button (a pencil icon) next to the delete button on the staff card.
  - Change the modal title dynamically: "Add Staff Member" vs "Edit Staff Member".
  - Change the submit button dynamically: "Save Staff Member" vs "Update Staff Member".
- **Submission Handler:** Update `handleAddStaff` (rename to `handleSaveStaff`) to determine whether to fire a `POST` (create) or a `PUT` (update) request depending on the `editingStaffId` state.

## Verification
- I will run the development server locally and verify that:
  - Clicking "Edit" populates the 4-week grid correctly.
  - Updating a week's schedule persists to the backend.
  - Adding a new staff member still works normally.

## Open Questions
- None. This is a straightforward CRUD (Create, Read, Update, Delete) extension of the system we just built.

Does this plan look good to you?


# supabase_auth_trigger.sql.md


CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS '
DECLARE
  new_tenant_id uuid;
  company_name_input text;
BEGIN
  company_name_input := COALESCE(NEW.raw_user_meta_data->>''company_name'', ''My Workspace'');
  INSERT INTO public.tenants (company_name) VALUES (company_name_input) RETURNING id INTO new_tenant_id;
  INSERT INTO public.profiles (id, tenant_id, role, is_super_admin) VALUES (NEW.id, new_tenant_id, ''owner'', false);
  RETURN NEW;
END;
';

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
```

### Part 2: Security Helper Functions
Clear the SQL editor, paste this second block, and run it.

```sql
CREATE OR REPLACE FUNCTION public.user_tenant_id()
RETURNS uuid AS '
  SELECT tenant_id FROM public.profiles WHERE id = auth.uid() LIMIT 1;
' LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean AS '
  SELECT is_super_admin FROM public.profiles WHERE id = auth.uid() LIMIT 1;
' LANGUAGE sql STABLE SECURITY DEFINER;
```

### Part 3: Enable RLS Policies
Clear the SQL editor, paste this final block, and run it.

```sql
ALTER TABLE public.chatbots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own chatbots" ON public.chatbots
  FOR SELECT USING (tenant_id = public.user_tenant_id() OR public.is_super_admin());

CREATE POLICY "Users can insert own chatbots" ON public.chatbots
  FOR INSERT WITH CHECK (tenant_id = public.user_tenant_id() OR public.is_super_admin());

CREATE POLICY "Users can update own chatbots" ON public.chatbots
  FOR UPDATE USING (tenant_id = public.user_tenant_id() OR public.is_super_admin());

CREATE POLICY "Users can delete own chatbots" ON public.chatbots
  FOR DELETE USING (tenant_id = public.user_tenant_id() OR public.is_super_admin());
```


# task.md


# Goal: Implement Modular Booking Modes

## Execution Tasks
- `[x]` **Database Migration:** Create `00000000000007_add_booking_modes.sql` (columns: `booking_mode`, `booking_url`).
- `[x]` **Backend Feed (page.tsx):** Update dashboard query to fetch `booking_mode` and `booking_url`.
- `[x]` **Dashboard UI:** Add a 4-option radio selector in the Scheduling tab, and conditionally hide/show staff, calendar, and external URL inputs.
- `[x]` **Chat Logic:** Update AI intent handling to respond correctly for `walk_in_only` and `external_platform`.


# walkthrough.md


# Reserve with Google Integration Completed

The integration for **Reserve with Google (Actions Center)** has been fully implemented into Styleflo.ai. 

This enables native "Book Online" functionality on Google Maps and Search profiles for all onboarded salons.

## What was built

### 1. Admin UI Configuration
- A dedicated **Integrations** tab was added to the `DashboardClient` allowing individual salon tenants to opt in and configure their Google alignment settings.
- The UI exposes a matching parameters form containing specific schema mappings (Business Name, Street Address, City, Postcode, Phone) to align strictly with Google Business Profiles.
- An interactive **"Run Integrity Check"** diagnostic button was added to simulate feed payload validation visually before any data is sent to Google.

### 2. Standardized JSON Feeds (Google v3 Schema)
We have exposed the critical endpoints required by Google to passively digest local inventory:
- **Merchants Feed** (`/api/rwg/feeds/merchants`): Outputs the localized store data configured via the dashboard.
- **Services Feed** (`/api/rwg/feeds/services`): Computes prices to `price_micros` alongside the relevant service configurations.
- **Availability Feed** (`/api/rwg/feeds/availability`): Dynamically computes the next 7 days of precise slot matrices, respecting staff working days, durations, buffers, and subtracting any internally sniped `appointments`.
- **Cron Pipeline** (`/api/rwg/feeds/cron`): Added an aggregating stub that triggers these tasks.

### 3. Realtime Webhooks (Google v3 API)
When a customer clicks the booking button on Google Maps, Google bypasses the daily feeds and executes high-priority REST webhooks to prevent double-booking:
- **`POST /api/v3/CheckAvailability`**: Validates the incoming slot timestamp against overlapping appointments in real time across staff members. Returns true/false mapping.
- **`POST /api/v3/CreateBooking`**: Safely receives the customer's payload directly from Google's servers, explicitly parsing `resources.staff_id` and injecting the new booking into the `appointments` database.

> [!TIP]
> The next step for production rollout is submitting these endpoints through the Google Partner Portal for end-to-end sandbox testing before flipping the switch on live inventory.

## Next Steps
You can navigate to `/dashboard` as a tenant to interact with the new **Integrations** panel. Let me know if you would like any modifications or further enhancements!


# walkthrough_booking_modes.md


# Modular Booking Modes Completed

The dashboard and core infrastructure have been upgraded to support your 4 completely distinct operational booking modes! 

## 1. The Booking Mode Selector
Under the **Scheduling & Staff** tab, you will now see a top-level **Operating Booking Mode** section. This allows salons to explicitly declare how they handle appointments.

The available options are:
1. **Walk-ins Only**: Disables all calendar and appointment logic.
2. **Single Unified Calendar**: Assumes all bookings drop into one central Google Calendar for the salon.
3. **Multi-Calendar (Per Staff)**: Maps individual bookings to specific staff members' Google Calendars.
4. **External Booking Link**: Hands off all booking requests to an existing Vagaro, Fresha, or other external platform.

## 2. Dynamic Dashboard UI
The interface now intelligently adapts based on the selected mode:
- **Walk-ins Only**: Hides the Google Calendar Sync connection button and staff roster entirely, since no appointments are managed.
- **Single Unified Calendar**: Hides the individual Google Calendar ID input boxes for staff members, as all bookings flow into the primary workspace calendar.
- **External Platform**: Hides internal Google Calendar configuration and presents a new text input: `External Booking URL`.

## 3. Intelligent Chatbot Routing
The AI assistant's brain (`/api/chat/stream/route.ts`) has been re-wired to respect the salon's chosen mode dynamically:
- If a user asks a **Walk-ins Only** bot to book an appointment, it will politely decline and state that they only accept walk-ins.
- If a user asks an **External Platform** bot to book an appointment, it will provide the direct URL (e.g. `https://fresha.com/...`) for them to complete the booking.
- In both of these modes, the bot's internal booking tools (`checkAvailability`, `bookMeeting`) are entirely revoked, completely eliminating the risk of AI hallucinating phantom appointments.

## 4. Reserve with Google Safeguard
I updated the Reserve with Google data feeds (`merchants`, `services`, `availability`). If a salon selects **External Platform**, they are automatically filtered out of the Reserve with Google sync pipeline. This prevents conflicting signals where Styleflo and an external platform both try to push the salon's schedule to Google at the same time.

> [!IMPORTANT]
> **Action Required**: I created the new schema migration [00000000000007_add_booking_modes.sql](file:///C:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/supabase/migrations/00000000000007_add_booking_modes.sql) to add the `booking_mode` and `booking_url` columns. Please run this SQL in your Supabase Dashboard to prevent the UI from crashing!
