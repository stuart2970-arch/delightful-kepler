---
date: 2026-09-10
tags:
  - styleflo
  - requirements
  - pricing
  - stripe
  - payments
status:
---
# Styleflo AI Package Pricing & Requirements

### Problem
The pricing and additional products has become to confusing for the average person to fathom, we also wanted StyleFlo to be different in the marketplace sowe have decided to restructure the pricing bands as follows.  The app engine must hide of grey out links to any features that are unavailable to the users tier, and when selected, the user must be displayed an upgare for this feature if they wish to proceed
## Core Packages
- **Basic**: Agent, Chat, Small Knowledgebase (metered) & Webpage
- **Starter**: Agent, Chat, Medium Knowledgebase (metered), Webpage & Calendar
- **Standard**: Agent, Chat, Voice and Calendar (Agent Chat, Large Knowledgebase (metered), Webpage, Calendar & Voice (metered))
## Bolt-ons
- Local phone line
- Mobile number
- WhatsApp
- Instagram
- Additional voice minutes

Every tier comes with web_presence, web_widget, ai_agent, website_chatbot & lead_capture.  These can be enabled by default in all tier types.

The current rules of any changes that reduce the allowance in any item will not be reflected in existing accounts, any increase will be added to existing accounts.

If the user creates a externally based chat, they may well be reinventing the wheel

The applicable amounts for remaining products can be seen in ßryle [app.styleflo.ai/superadmin](http://app.styleflo.ai/superadmin) under Pricing and Packaging.  The prices for monthly and yearly are currently displayed in $ and this must be altered to GBP £

Any changes to this page must be acknowledged by the superadmin and a notification must be displayed to confirm the date and time, along with the changes, these must also be displayed on the base of the page as an addendum.

Any changes to the items on this page must also be dynamically updated on the [styleflo.ai](http://styleflo.ai) landing page 

### General Observations
styleflo tier pricing does not work in its current format, this is how the other suppliers are doing it and styleflo is different, we want users to have choice and total control of the products they pay for.  for starting up, the user should be able to
1. build an agent
2. 

|                |        |      |        |            |        |       |                                          |            |       |              |        |              |        |     |
| -------------- | ------ | ---- | ------ | ---------- | ------ | ----- | ---------------------------------------- | ---------- | ----- | ------------ | ------ | ------------ | ------ | --- |
| **Technology** |        |      |        |            |        |       | Feature                                  | Basic Tier |       | Starter Tier |        | Premium Tier |        |     |
| Twilio         | Gemini | Vapi | 11Labs | Cloudflare | Google | Cloud |                                          | Month      | Year  | Month        | Year   | Month        | Year   |     |
|                |        |      |        |            |        |       |                                          | 4.99       | 49.90 | 19.99        | 199.00 | 49.99        | 499.00 |     |
|                |        |      |        |            |        | Y     | Knowledge Base Data (chunks)             | 50         |       | 300          |        | 1000         |        |     |
|                |        |      |        |            |        |       | **Chat**                                 |            |       |              |        |              |        |     |
|                | Y      |      |        |            |        | Y     | Monthly Web Chat Messages                | 750        |       | 1500         |        | 2000         |        |     |
|                |        |      |        |            |        |       | **Bookings**                             |            |       |              |        |              |        |     |
|                | Y      |      |        |            | Y      |       | Calendar Booking                         | N          |       | N            |        | N            |        |     |
|                | Y      |      |        |            | Y      |       | Google Calendar Bookings (max calendars) | 0          |       | 0            |        | 0            |        |     |
|                | Y      |      |        |            | Y      |       | Reserve With Google                      | N          |       | N            |        | N            |        |     |
|                |        |      |        |            |        | Y     | Staff Bio & Rota                         | 0          |       | 0            |        | 0            |        |     |
|                |        |      |        |            |        | Y     | Service Limit                            | 0          |       | 0            |        | 0            |        |     |
|                |        |      |        |            |        |       | **Web Page**                             |            |       |              |        |              |        |     |
|                |        |      |        |            |        |       | Remove Styleflo Branding                 | N          |       | N            |        | N            |        |     |
|                |        |      |        |            |        |       | **Voice**                                |            |       |              |        |              |        |     |
| Y              |        |      |        |            |        |       | Landline Number                          | N          |       | N            |        | N            |        |     |
| Y              |        |      |        |            |        |       | Mobile Number                            | N          |       | N            |        | N            |        |     |
|                |        | Y    | Y      |            |        |       | Voice Minutes                            | 0          |       | 15           |        | 30           |        |     |
| Y              |        | Y    | Y      |            |        |       |                                          |            |       |              |        |              |        |     |
|                |        |      |        |            |        |       | **Social**                               |            |       |              |        |              |        |     |
| Y              |        | Y    | Y      |            |        |       | Whatsapp                                 | N          |       | N            |        | N            |        |     |
|                |        |      |        |            |        |       | Instagram                                | N          |       | N            |        | N            |        |     |
| Y              |        |      |        |            |        |       | SMS Reminders                            | N          |       | N            |        | N            |        |     |
| Y              |        |      |        |            |        |       | SMS Marketing                            | N          |       | N            |        | N            |        |     |
| Y              |        |      |        |            |        |       | SMS Marketing Messages                   | 0          |       | 0            |        | 0            |        |     |

custom_domain, inventory_control, crm_zapier_sync, & email_marketing have yet to be fully developed and should not be mentioned.

For users on a lower tier

Knowledgebase chunks - If a users account reached 85% capacity based on data stored, there must be a banner displayed at the top of the dashboard landing page with the following text ‘you have now used [xx%] of allocated knowledgebase memory, you can either upgrade to the next tier for [£XX]* now, then [new_tier_price] per month thereafter

* = days_until_last_payment x diff_between_tiers eg. user on starter upgraded to premier on the 15th then the cost would be 15 (days until next payment) = (79/30x15)-(29/30x15)=25.00

The above also applies if any of the following capacities reach 85%

- Phone Voice Agent Minutes (vapi_voice_minutes)
- Webchat Voice Agent Limits (voice_agent_minutes_web)
- Services Limit (services_limit)
- SMS Reminders (sms)
- SMS Marketing (sms_marketing)

If the user is on the Premium Tier and reaches 85% they must be given the opportunity to increase their allowances on all measurable amount items by 30%

- Monthly Webchat Messages (message_allowance)
- Knowledgebase Date Chunks (knowledge_data_chunks)
- Google Calendar Bookings (google_calendar)
- Staff Bio & Rota (staff_names)
- Services Limit (services_limit)
- Website Voice Agent Limits (voice_agent_minutes_web)
- Phone Voice Agent Minutes (vapi_voice_minutes)
- SMS Reminders (sms)
- SMS Marketing (sms_marketing)
- SMS Messaging (messaging_sms)

For a 20% increase in payments, again, pro rata for the remainder of the current month, then £15.80 additionally per month thereafter £79.00 + 20% = £94.80)

Users on annual payment plans must be calculated for the remainder of the year

If a feature is unavailable to a user due to their tier level, the area/ button must be greyed out, and if clicked, a popup should open asking them if they would like to upgrade to the next tier.

Any increase in payments or upgrades must be available in stripe as an option to send the user to for payment processing, as soon as the payment is processed, the user account must be upgraded





In the account settings tab, there must be an area where users can access/ download any billing receipts/ invoices relevant for their account, or a link to the wpmu customer portal
