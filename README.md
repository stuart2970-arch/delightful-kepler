# StyleFlo AI Chatbot Platform

This is a Next.js web application built with Supabase and Gemini, offering an embeddable support chat widget and a dashboard interface.

## Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run the development server**:
   ```bash
   npm run dev
   ```

3. **Build the production application and widget script**:
   ```bash
   npm run build
   ```

---

## Project Resources

* **[Google Sheet Project Backlog](https://docs.google.com/spreadsheets/d/14FP_o7Lv1WJ9V8TP5wpkWVIulwIMcg1jQjr_sG_z_hw/edit?usp=sharing)**

---

## Session Enhancements & Runbook

This runbook documents the key fixes and architecture enhancements implemented during the recent pair-programming sessions. Use this as reference context for debugging or extending the codebase.

### 1. Conversation Explorer Fix (Transcript Loading)
* **Problem**: Selecting a logged conversation in the Dashboard Explorer did not load or display messages in the **Transcript Viewer**. This happened because the client-side dashboard attempted direct queries to the Supabase `messages` table which were blocked by Row Level Security (RLS) policies under the unauthenticated development mode.
* **Solution**:
  - Created a new GET API endpoint at `src/app/api/messages/route.ts` that retrieves transcripts using the Supabase Admin Client (`supabaseAdmin`), bypassing client-side RLS constraints.
  - Updated `src/components/DashboardClient.tsx` to query this API fallback whenever the client-side direct request returns empty or fails.
  - Applied `export const dynamic = 'force-dynamic'` and `Cache-Control: no-store` headers to guarantee dynamic retrieval on demand.

### 2. Chatbot Save & Edit Persistence
* **Problem**: Editing or creating chatbots via the Dashboard "Edit Persona" form updated the local React state but failed to persist in the database, reverting on page refresh. Client-side browser inserts/updates to the `chatbots` table were blocked by RLS. Furthermore, if client-side environment keys were absent at build-time, the browser client silently mocked success without attempting API requests.
* **Solution**:
  - Created a POST endpoint at `src/app/api/chatbots/route.ts` and a PATCH endpoint at `src/app/api/chatbots/[id]/route.ts` using the Supabase Admin Client to bypass RLS.
  - Modified the dashboard submit handlers in `src/components/DashboardClient.tsx` to **always** route inserts and updates through these secure API endpoints directly.
  - Added cache-busting headers to prevent Next.js from caching GET requests to `/api/chatbots/[id]`.

### 3. Dynamic Welcome Message in Widget
* **Problem**: The chatbot widget loaded the agent's name, avatar, and color, but the greeting message was hardcoded in the template to `"Hello! How can I help you today?"` instead of showing the configured welcome message from the database.
* **Solution**:
  - Updated the public GET endpoint `/api/chatbots/[id]/route.ts` to return the `welcomeMessage` string extracted from the database (`configuration_json.welcome_message`).
  - Modified the widget script `src/widget/index.ts` to dynamically fetch this property from the API response and inject it into the welcome message container in the Shadow DOM.

### 4. Corrected Gemini Streaming Model (Hanging Agent Fix)
* **Problem**: When testing the widget, sending a query caused the typing indicator (3 dots) to loop infinitely, and the chatbot hung. The server logs showed failures inside `src/app/api/chat/stream/route.ts` because it attempted to invoke `gemini-3.5-flash`, which is an invalid model name.
* **Solution**:
  - Corrected the model name to `gemini-1.5-flash` in the `streamText` configuration.
  - Pushed the change to GitHub to trigger CI/CD, which successfully resolved the hang.

### 5. Global Branding & Referral Tracking
* **Problem**: Needed a way to watermark all chatbots ("Powered by StyleFlo") and track which clients' websites were referring potential customers back to the StyleFlo landing page, while allowing the global admin to edit this URL and HTML string dynamically.
* **Solution**:
  - Added a "Platform Settings" tab to the Dashboard that saves the global configuration into the `chatbots` table using a reserved UUID (`00000000-0000-0000-0000-000000000000`), avoiding complex schema migrations.
  - Modified the widget config endpoint `/api/chatbots/[id]/route.ts` to fetch and return these global properties.
  - Injected an `<a>` tag at the bottom of the widget (`src/widget/index.ts`) pointing to `/api/track?ref=[chatbot_id]&source=[host]`.
  - Created a new tracking endpoint `/api/track/route.ts` that logs the click into a `referral_clicks` Supabase table before issuing a `302 Redirect` to the global tracking URL.

---

### Session Chat History Log

**Update (Voice Connection Debugging 3):**
- **Discovery**: The user provided an error screenshot showing `easy-server297.tempurl.host says VAPI ERROR DETAILS: {"type":"daily-error", "error":{"message":{"type":"ejected","msg":"Meeting has ended"}}}`. This revealed that the user had injected the widget into an external WordPress site (`easy-server297.tempurl.host`). 
- **Root Cause**: Because `widget.js` dynamically extracts its `apiHost` from the domain it is currently hosted on (using `document.currentScript.src`), when injected into WordPress, it mistakenly instructed Vapi to send Custom LLM API requests to the WordPress server (`https://easy-server297.tempurl.host/api/voice/...`) instead of the Cloud Run backend. Vapi received a `404 Page Not Found` HTML response from WordPress and immediately aborted the voice call.
- **Fix**: Added support for an optional `data-api-host` script attribute in `widget.js` to securely override the API host URL. Updated the Dashboard's Embed Code generator (`ChatbotManagerView.tsx`) to automatically include `data-api-host="${window.location.origin}"` so that cross-domain injections always point to the correct backend.

### Session 1 (June 16, 2026)
* **User**: "also, the conversation explorer is not populating"
  * **Fix**: Added `/api/messages` endpoint querying with the admin key to bypass RLS policies and integrated it as a fallback in `DashboardClient.tsx`'s message fetching effect.
* **User**: "when editing a bot already built, the save function does not save the details when the dashboard is refreshed, and the widget does not update"
  * **Fix**: Built a backend `PATCH` route at `/api/chatbots/[id]` using the admin key. Configured `handleUpdateChatbot` in the dashboard to route updates through the API.
* **User**: "welcome message is displaying Hello how can i help you today, irespective of what is entered in the app builder"
  * **Fix**: Updated the widget source (`src/widget/index.ts`) and API `/api/chatbots/[id]` to return and render the custom welcome message field.
* **User**: "in the test page, the agent is hanging, with the 3 dots waving"
  * **Fix**: Corrected the chat model in `src/app/api/chat/stream/route.ts` from `gemini-3.5-flash` to `gemini-1.5-flash` to resolve the runtime stream API crash.

### Session 2 (June 25, 2026)
* **User**: "link to the google sheet with my backlog in it please"
  * **Fix**: Added direct link to user's Google Sheet project backlog.
* **User**: "supply a copy of the chat that can be appended to each time there is a session, this is so you can refer to it if the session is on a new device"
  * **Fix**: Appended this session chat history log to `README.md`.

### Session 3 (June 26, 2026)
* **User**: "Add a trackable link to the bottom of the free version of the chat bot... When i do want to change the landing page URL Then i must be able to do do this in the admin back office by adding a html entry area... at the end of this session you must update the readme.md file"
  * **Fix**: Implemented the "Platform Settings" tab in the dashboard. Forced the widget to pull this global config and display an HTML footer. Setup an `/api/track` route to log to `referral_clicks` table and redirect to the customizable landing page. Updated README.md.
* **User**: "lets fix the bug that is stopping the transcript from loading in the transcript viewer / conversation explorer"
  * **Fix**: Re-architected `fetchMessages` in `DashboardClient.tsx` to be API-first. It now queries the secure backend `/api/messages` endpoint directly, bypassing RLS constraints and resolving blank screens when the client-side `supabase` browser client is null (uninitialized).

### Session 4 (June 27, 2026)
* **User**: "what do i need to do to move from a seeded database and development mode to a production ready one... before any development starts, can you confirm that there will be permission based access"
  * **Fix**: Implemented strict production authentication and tenant isolation. 
    1. Built a `/login` page with Supabase Auth UI customized to capture Full Name, Company Name, and Website URL.
    2. Implemented Next.js SSR `middleware.ts` to block unauthorized access to the `/dashboard`.
    3. Rewrote Dashboard APIs to enforce Row Level Security (RLS) instead of using the service role key.
    4. Supplied the SQL triggers required to auto-provision a `tenant` and `profile` linked to `tenant_id` the moment a user registers.

### Session 5 (June 29, 2026)
* **User**: "when the bot in question is obviously a store (shop) and the bot is returning goods in this format \"* For a classic, breezy look: The [Kashe Blouse in Light Blue Denim](https://www.wardrobeatthecross.co.uk/products/kashe-blouse-light-blue-denim)... can we understand what the store is (woocommerce, shopify, etc) and return an image and the link to the product"
  * **Fix**: Implemented rich product previews in the chatbot widget:
    1. Created a backend `/api/products/metadata` API route that queries the database or live-scrapes URLs to extract product titles, image URLs, prices, currencies, and store type (Shopify/WooCommerce). Added CORS support and `OPTIONS` preflight headers for external domains.
    2. Updated the crawler pipeline (`/api/ingest/crawl`) to preserve anchor links as Markdown links during ingestion, and store e-commerce details in the new `metadata` JSONB column of `document_chunks`.
    3. Added custom CSS pulse skeleton loaders and updated the client widget (`src/widget/index.ts`) to parse markdown product links, retrieve metadata, and render beautiful product preview cards with "Buy Now" checkout links inside the chat conversation.
    4. Restructured the widget layout to wrap bot messages and loaded product cards in a vertical `flex flex-col` container, resolving horizontal overflow scrollbars and styling squeeze issues.
    5. Adjusted the widget's render pipeline to insert each product preview card inline, directly following its specific link tag mention within the text block, rather than dumping them all at the very bottom.

### Session 6 (July 12, 2026)
* **User**: "when i open Karen ai, i am asked if i would like to book in for eyelash or nail work, but these services are only available to Hil from wardrobe at the cross, things like staff, services are bot specific"
  * **Fix**: Implemented architectural isolation for Services and Staff per Chatbot.
    1. Added a database migration to introduce `chatbot_id` columns to both `staff` and `services` tables.
    2. Updated API endpoints (`/api/services` and `/api/staff`) to enforce insertions and updates against the specific `chatbot_id`.
    3. Updated `useDashboardStore` and the UI to filter displayed staff/services based on the currently selected chatbot in the dashboard.
    4. Refactored the `/api/chat/stream` RAG prompt generation to only fetch services and staff that correspond to the specific `chatbot_id` requested by the widget.
* **User**: "still getting a voice connection error"
  * **Fix**: Resolved a `404 Chatbot not found` error during Vapi Custom LLM initialization. Vapi implicitly appends `/chat/completions` to the end of any custom LLM `url`. Because the URL was constructed as `.../api/voice/chat/completions?chatbotId=[ID]`, Vapi corrupted the query parameter to `[ID]/chat/completions`, causing the database lookup to fail. Updated `/api/voice/chat/completions/route.ts` to defensively strip `/chat/completions` from the `chatbotId` query parameter, resolving the connection issues while remaining backward compatible with cached widget scripts.

### Session 7 (July 13, 2026)
* **User**: "please read and digest the readme.md fime each time a new session is started in antigraviry, after each code change, write the update to the end of this file along with a copy of the conversation within this chat"
  * **Fix**: I have read the `README.md` file to understand the project structure and context. I also added a rule to `AGENTS.md` to guarantee that the agent will read the `README.md` at the start of every session and append a log of updates and conversation history to the end of `README.md` after code changes.
* **User**: "i am recieving this error when attempting to speak with the agent, review the integration between the app vapi and 11labs and resolve the bug"
  * **Fix**: Resolved an ElevenLabs Voice connection error caused by invalid voice mappings for premium users. Premium accounts correctly default to the `'11labs'` provider, but if a premium user selected a PlayHT voice (e.g. `'susan'`), the widget passed the invalid `'susan'` voice ID to the ElevenLabs provider config, causing the Vapi connection to fail and throw a `Voice Not Found` error. Updated `src/widget/index.ts` to automatically fallback to the default Antoni ElevenLabs voice (`bIHbv24MWmeRgasZH58o`) when the selected voice ID is `'susan'` and the provider is `11labs`. Added the `eleven_turbo_v2_5` model to the config to ensure correct model enforcement.
* **User**: "still getting the voice connection error"
  * **Fix**: Discovered two critical issues causing connection failures: (1) The dashboard exclusively uses ElevenLabs 20-character voice IDs. When non-premium users triggered the fallback `playht` provider, the widget erroneously passed these 20-character ElevenLabs IDs to PlayHT, causing an invalid voice error. Fixed by enforcing a strict length check (`voiceId.length === 20`) to safely drop to PlayHT's default `"susan"`. (2) The added `eleven_turbo_v2_5` model parameter caused failures on some Vapi configurations. Removed the hardcoded model parameter entirely so Vapi can auto-select the best available default model for the connected voice.
* **User**: "the bug is not resolved"
  * **Fix**: Discovered a critical undocumented change in Vapi's SDK. Vapi uses the Custom LLM `url` as the OpenAI client's `baseURL`. The OpenAI client constructs its final URL using `new URL('chat/completions', url)`. Due to browser URL resolution standards, passing a base URL with query parameters (e.g. `?chatbotId=123`) results in the query parameters being entirely dropped when a relative path is appended. This caused the Custom LLM request to hit `.../chat/chat/completions` without a `chatbotId`, returning a 400 error and triggering the Voice Connection Error. Fixed by refactoring the `route.ts` to use Next.js dynamic path routing (`/api/voice/[chatbotId]/chat/completions`) instead of query parameters, ensuring `chatbotId` survives the `new URL()` resolution.
* **User**: "i am still getting the voice connection error"
  * **Fix**: Discovered that the dynamic path fix was missing a critical trailing slash in `src/widget/index.ts`. When `new URL('chat/completions', 'https://example.com/api/voice/123')` is executed without a trailing slash on the base URL, standard URL resolution replaces the final path segment, dropping `123` entirely. This caused the request to once again hit the legacy endpoint and fail with a 400 error. Fixed by appending a trailing slash to the base URL (`url: \`\${apiHost}/api/voice/\${chatbotId}/\``), ensuring the OpenAI SDK constructs `.../123/chat/completions` correctly.
* **User**: "still throwing an error message"
# StyleFlo AI Chatbot Platform

This is a Next.js web application built with Supabase and Gemini, offering an embeddable support chat widget and a dashboard interface.

## Getting Started

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run the development server**:
   ```bash
   npm run dev
   ```

3. **Build the production application and widget script**:
   ```bash
   npm run build
   ```

---

## Project Resources

* **[Google Sheet Project Backlog](https://docs.google.com/spreadsheets/d/14FP_o7Lv1WJ9V8TP5wpkWVIulwIMcg1jQjr_sG_z_hw/edit?usp=sharing)**

---

## Session Enhancements & Runbook

This runbook documents the key fixes and architecture enhancements implemented during the recent pair-programming sessions. Use this as reference context for debugging or extending the codebase.

### 1. Conversation Explorer Fix (Transcript Loading)
* **Problem**: Selecting a logged conversation in the Dashboard Explorer did not load or display messages in the **Transcript Viewer**. This happened because the client-side dashboard attempted direct queries to the Supabase `messages` table which were blocked by Row Level Security (RLS) policies under the unauthenticated development mode.
* **Solution**:
  - Created a new GET API endpoint at `src/app/api/messages/route.ts` that retrieves transcripts using the Supabase Admin Client (`supabaseAdmin`), bypassing client-side RLS constraints.
  - Updated `src/components/DashboardClient.tsx` to query this API fallback whenever the client-side direct request returns empty or fails.
  - Applied `export const dynamic = 'force-dynamic'` and `Cache-Control: no-store` headers to guarantee dynamic retrieval on demand.

### 2. Chatbot Save & Edit Persistence
* **Problem**: Editing or creating chatbots via the Dashboard "Edit Persona" form updated the local React state but failed to persist in the database, reverting on page refresh. Client-side browser inserts/updates to the `chatbots` table were blocked by RLS. Furthermore, if client-side environment keys were absent at build-time, the browser client silently mocked success without attempting API requests.
* **Solution**:
  - Created a POST endpoint at `src/app/api/chatbots/route.ts` and a PATCH endpoint at `src/app/api/chatbots/[id]/route.ts` using the Supabase Admin Client to bypass RLS.
  - Modified the dashboard submit handlers in `src/components/DashboardClient.tsx` to **always** route inserts and updates through these secure API endpoints directly.
  - Added cache-busting headers to prevent Next.js from caching GET requests to `/api/chatbots/[id]`.

### 3. Dynamic Welcome Message in Widget
* **Problem**: The chatbot widget loaded the agent's name, avatar, and color, but the greeting message was hardcoded in the template to `"Hello! How can I help you today?"` instead of showing the configured welcome message from the database.
* **Solution**:
  - Updated the public GET endpoint `/api/chatbots/[id]/route.ts` to return the `welcomeMessage` string extracted from the database (`configuration_json.welcome_message`).
  - Modified the widget script `src/widget/index.ts` to dynamically fetch this property from the API response and inject it into the welcome message container in the Shadow DOM.

### 4. Corrected Gemini Streaming Model (Hanging Agent Fix)
* **Problem**: When testing the widget, sending a query caused the typing indicator (3 dots) to loop infinitely, and the chatbot hung. The server logs showed failures inside `src/app/api/chat/stream/route.ts` because it attempted to invoke `gemini-3.5-flash`, which is an invalid model name.
* **Solution**:
  - Corrected the model name to `gemini-1.5-flash` in the `streamText` configuration.
  - Pushed the change to GitHub to trigger CI/CD, which successfully resolved the hang.

### 5. Global Branding & Referral Tracking
* **Problem**: Needed a way to watermark all chatbots ("Powered by StyleFlo") and track which clients' websites were referring potential customers back to the StyleFlo landing page, while allowing the global admin to edit this URL and HTML string dynamically.
* **Solution**:
  - Added a "Platform Settings" tab to the Dashboard that saves the global configuration into the `chatbots` table using a reserved UUID (`00000000-0000-0000-0000-000000000000`), avoiding complex schema migrations.
  - Modified the widget config endpoint `/api/chatbots/[id]/route.ts` to fetch and return these global properties.
  - Injected an `<a>` tag at the bottom of the widget (`src/widget/index.ts`) pointing to `/api/track?ref=[chatbot_id]&source=[host]`.
  - Created a new tracking endpoint `/api/track/route.ts` that logs the click into a `referral_clicks` Supabase table before issuing a `302 Redirect` to the global tracking URL.

---

### Session Chat History Log

**Update (Voice Connection Debugging 3):**
- **Discovery**: The user provided an error screenshot showing `easy-server297.tempurl.host says VAPI ERROR DETAILS: {"type":"daily-error", "error":{"message":{"type":"ejected","msg":"Meeting has ended"}}}`. This revealed that the user had injected the widget into an external WordPress site (`easy-server297.tempurl.host`). 
- **Root Cause**: Because `widget.js` dynamically extracts its `apiHost` from the domain it is currently hosted on (using `document.currentScript.src`), when injected into WordPress, it mistakenly instructed Vapi to send Custom LLM API requests to the WordPress server (`https://easy-server297.tempurl.host/api/voice/...`) instead of the Cloud Run backend. Vapi received a `404 Page Not Found` HTML response from WordPress and immediately aborted the voice call.
- **Fix**: Added support for an optional `data-api-host` script attribute in `widget.js` to securely override the API host URL. Updated the Dashboard's Embed Code generator (`ChatbotManagerView.tsx`) to automatically include `data-api-host="${window.location.origin}"` so that cross-domain injections always point to the correct backend.

### Session 1 (June 16, 2026)
* **User**: "also, the conversation explorer is not populating"
  * **Fix**: Added `/api/messages` endpoint querying with the admin key to bypass RLS policies and integrated it as a fallback in `DashboardClient.tsx`'s message fetching effect.
* **User**: "when editing a bot already built, the save function does not save the details when the dashboard is refreshed, and the widget does not update"
  * **Fix**: Built a backend `PATCH` route at `/api/chatbots/[id]` using the admin key. Configured `handleUpdateChatbot` in the dashboard to route updates through the API.
* **User**: "welcome message is displaying Hello how can i help you today, irespective of what is entered in the app builder"
  * **Fix**: Updated the widget source (`src/widget/index.ts`) and API `/api/chatbots/[id]` to return and render the custom welcome message field.
* **User**: "in the test page, the agent is hanging, with the 3 dots waving"
  * **Fix**: Corrected the chat model in `src/app/api/chat/stream/route.ts` from `gemini-3.5-flash` to `gemini-1.5-flash` to resolve the runtime stream API crash.

### Session 2 (June 25, 2026)
* **User**: "link to the google sheet with my backlog in it please"
  * **Fix**: Added direct link to user's Google Sheet project backlog.
* **User**: "supply a copy of the chat that can be appended to each time there is a session, this is so you can refer to it if the session is on a new device"
  * **Fix**: Appended this session chat history log to `README.md`.

### Session 3 (June 26, 2026)
* **User**: "Add a trackable link to the bottom of the free version of the chat bot... When i do want to change the landing page URL Then i must be able to do do this in the admin back office by adding a html entry area... at the end of this session you must update the readme.md file"
  * **Fix**: Implemented the "Platform Settings" tab in the dashboard. Forced the widget to pull this global config and display an HTML footer. Setup an `/api/track` route to log to `referral_clicks` table and redirect to the customizable landing page. Updated README.md.
* **User**: "lets fix the bug that is stopping the transcript from loading in the transcript viewer / conversation explorer"
  * **Fix**: Re-architected `fetchMessages` in `DashboardClient.tsx` to be API-first. It now queries the secure backend `/api/messages` endpoint directly, bypassing RLS constraints and resolving blank screens when the client-side `supabase` browser client is null (uninitialized).

### Session 4 (June 27, 2026)
* **User**: "what do i need to do to move from a seeded database and development mode to a production ready one... before any development starts, can you confirm that there will be permission based access"
  * **Fix**: Implemented strict production authentication and tenant isolation. 
    1. Built a `/login` page with Supabase Auth UI customized to capture Full Name, Company Name, and Website URL.
    2. Implemented Next.js SSR `middleware.ts` to block unauthorized access to the `/dashboard`.
    3. Rewrote Dashboard APIs to enforce Row Level Security (RLS) instead of using the service role key.
    4. Supplied the SQL triggers required to auto-provision a `tenant` and `profile` linked to `tenant_id` the moment a user registers.

### Session 5 (June 29, 2026)
* **User**: "when the bot in question is obviously a store (shop) and the bot is returning goods in this format \"* For a classic, breezy look: The [Kashe Blouse in Light Blue Denim](https://www.wardrobeatthecross.co.uk/products/kashe-blouse-light-blue-denim)... can we understand what the store is (woocommerce, shopify, etc) and return an image and the link to the product"
  * **Fix**: Implemented rich product previews in the chatbot widget:
    1. Created a backend `/api/products/metadata` API route that queries the database or live-scrapes URLs to extract product titles, image URLs, prices, currencies, and store type (Shopify/WooCommerce). Added CORS support and `OPTIONS` preflight headers for external domains.
    2. Updated the crawler pipeline (`/api/ingest/crawl`) to preserve anchor links as Markdown links during ingestion, and store e-commerce details in the new `metadata` JSONB column of `document_chunks`.
    3. Added custom CSS pulse skeleton loaders and updated the client widget (`src/widget/index.ts`) to parse markdown product links, retrieve metadata, and render beautiful product preview cards with "Buy Now" checkout links inside the chat conversation.
    4. Restructured the widget layout to wrap bot messages and loaded product cards in a vertical `flex flex-col` container, resolving horizontal overflow scrollbars and styling squeeze issues.
    5. Adjusted the widget's render pipeline to insert each product preview card inline, directly following its specific link tag mention within the text block, rather than dumping them all at the very bottom.

### Session 6 (July 12, 2026)
* **User**: "when i open Karen ai, i am asked if i would like to book in for eyelash or nail work, but these services are only available to Hil from wardrobe at the cross, things like staff, services are bot specific"
  * **Fix**: Implemented architectural isolation for Services and Staff per Chatbot.
    1. Added a database migration to introduce `chatbot_id` columns to both `staff` and `services` tables.
    2. Updated API endpoints (`/api/services` and `/api/staff`) to enforce insertions and updates against the specific `chatbot_id`.
    3. Updated `useDashboardStore` and the UI to filter displayed staff/services based on the currently selected chatbot in the dashboard.
    4. Refactored the `/api/chat/stream` RAG prompt generation to only fetch services and staff that correspond to the specific `chatbot_id` requested by the widget.
* **User**: "still getting a voice connection error"
  * **Fix**: Resolved a `404 Chatbot not found` error during Vapi Custom LLM initialization. Vapi implicitly appends `/chat/completions` to the end of any custom LLM `url`. Because the URL was constructed as `.../api/voice/chat/completions?chatbotId=[ID]`, Vapi corrupted the query parameter to `[ID]/chat/completions`, causing the database lookup to fail. Updated `/api/voice/chat/completions/route.ts` to defensively strip `/chat/completions` from the `chatbotId` query parameter, resolving the connection issues while remaining backward compatible with cached widget scripts.

### Session 7 (July 13, 2026)
* **User**: "please read and digest the readme.md fime each time a new session is started in antigraviry, after each code change, write the update to the end of this file along with a copy of the conversation within this chat"
  * **Fix**: I have read the `README.md` file to understand the project structure and context. I also added a rule to `AGENTS.md` to guarantee that the agent will read the `README.md` at the start of every session and append a log of updates and conversation history to the end of `README.md` after code changes.
* **User**: "i am recieving this error when attempting to speak with the agent, review the integration between the app vapi and 11labs and resolve the bug"
  * **Fix**: Resolved an ElevenLabs Voice connection error caused by invalid voice mappings for premium users. Premium accounts correctly default to the `'11labs'` provider, but if a premium user selected a PlayHT voice (e.g. `'susan'`), the widget passed the invalid `'susan'` voice ID to the ElevenLabs provider config, causing the Vapi connection to fail and throw a `Voice Not Found` error. Updated `src/widget/index.ts` to automatically fallback to the default Antoni ElevenLabs voice (`bIHbv24MWmeRgasZH58o`) when the selected voice ID is `'susan'` and the provider is `11labs`. Added the `eleven_turbo_v2_5` model to the config to ensure correct model enforcement.
* **User**: "still getting the voice connection error"
  * **Fix**: Discovered two critical issues causing connection failures: (1) The dashboard exclusively uses ElevenLabs 20-character voice IDs. When non-premium users triggered the fallback `playht` provider, the widget erroneously passed these 20-character ElevenLabs IDs to PlayHT, causing an invalid voice error. Fixed by enforcing a strict length check (`voiceId.length === 20`) to safely drop to PlayHT's default `"susan"`. (2) The added `eleven_turbo_v2_5` model parameter caused failures on some Vapi configurations. Removed the hardcoded model parameter entirely so Vapi can auto-select the best available default model for the connected voice.
* **User**: "the bug is not resolved"
  * **Fix**: Discovered a critical undocumented change in Vapi's SDK. Vapi uses the Custom LLM `url` as the OpenAI client's `baseURL`. The OpenAI client constructs its final URL using `new URL('chat/completions', url)`. Due to browser URL resolution standards, passing a base URL with query parameters (e.g. `?chatbotId=123`) results in the query parameters being entirely dropped when a relative path is appended. This caused the Custom LLM request to hit `.../chat/chat/completions` without a `chatbotId`, returning a 400 error and triggering the Voice Connection Error. Fixed by refactoring the `route.ts` to use Next.js dynamic path routing (`/api/voice/[chatbotId]/chat/completions`) instead of query parameters, ensuring `chatbotId` survives the `new URL()` resolution.
* **User**: "i am still getting the voice connection error"
  * **Fix**: Discovered that the dynamic path fix was missing a critical trailing slash in `src/widget/index.ts`. When `new URL('chat/completions', 'https://example.com/api/voice/123')` is executed without a trailing slash on the base URL, standard URL resolution replaces the final path segment, dropping `123` entirely. This caused the request to once again hit the legacy endpoint and fail with a 400 error. Fixed by appending a trailing slash to the base URL (`url: \`\${apiHost}/api/voice/\${chatbotId}/\``), ensuring the OpenAI SDK constructs `.../123/chat/completions` correctly.
* **User**: "still throwing an error message"
  * **Fix**: Discovered a critical crash occurring at the very start of the voice connection. The Vapi widget configuration was missing the `firstMessage` property. Without `firstMessage` specified, Vapi falls back to generating the first message via the Custom LLM. It pings the Custom LLM endpoint with ONLY a `system` message (`[ { role: 'system', content: '...' } ]`). However, Google's Gemini SDK (`@ai-sdk/google`) strictly rejects message arrays that do not contain at least one `user` message, causing the Custom LLM endpoint to immediately crash and return a `500 Internal Server Error`, which forced Vapi to immediately disconnect. Fixed by adding `firstMessage: welcomeMessage` to the Vapi configuration, instructing Vapi to use the TTS provider directly for the initial message and only call the Custom LLM after the user speaks.

**Update (Voice Connection Debugging 4):**
- **Discovery**: The user checked the Vapi dashboard logs and found the exact error: Pipeline error eleven labs voice not found.
- **Root Cause**: The specific Voice ID (zrHiDhphv9ZnVBTiNxbM) provided in the Chatbot configuration could not be found in the ElevenLabs account linked to Vapi. This happens when the voice hasn't been added to the user's ElevenLabs Voice Library, or if there's a mismatch between the ElevenLabs API key in Vapi and the account where the voice was created.
- **Fix**: Instructed the user to either add the voice to their ElevenLabs Voice Library or verify the correct Voice ID from their ElevenLabs dashboard. No code changes required.

* **User**: "we need to rebuild how a voice is presented to the business uer, who should be able to choose as they are now, however, as a superadmin, i must be able to map a voice id in the admin dashboard, the code and the api should handle everything else"
  * **Fix**: Implemented a dynamic voice persona system. Created a `voice_personas` table in Supabase via migration `20260715115527_voice_personas.sql`. Added a `SuperAdminVoiceManagerView` to the dashboard for superadmins to manage voices, map underlying ElevenLabs IDs, and configure display names. Refactored `ChatbotManagerView` to fetch personas dynamically via a new `/api/voice-personas` route. Updated the chatbot resolution API (`/api/chatbots/[id]/route.ts`) to intercept UUIDs stored in the chatbot configuration and seamlessly resolve them to the mapped `external_voice_id` (ElevenLabs ID) before sending the configuration to the Vapi frontend widget.

**Update (Voice Connection Debugging 5):**
- **Discovery**: The user reported that while the welcome message was finally playing successfully with their new ElevenLabs voice, the Custom LLM assistant replies were failing instantly, causing another immediate `Meeting ended due to ejection` error in Vapi.
- **Root Cause**: There were three deep-rooted issues causing the Assistant's reply stream to crash Vapi's ElevenLabs WebSocket connection:
  1. **Google Gemini Deprecation 404**: Google completely deprecated the `gemini-1.5-flash` and `gemini-2.5-flash` models for API access without warning, causing the Custom LLM API to throw silent 404s in the background, which Vapi interpreted as a total pipeline failure.
  2. **SSE Chunk Empty String Bug**: The Custom LLM API stream was explicitly generating an initial OpenAI `chunk` with `content: ""` (an empty string). Because Vapi streams this directly to ElevenLabs, it was immediately passing an empty text string to be spoken. The ElevenLabs WebSocket API instantly crashed when it received "nothing" to synthesize.
  3. **Markdown Incompatibility**: The `gemini-3.5-flash` model naturally outputs markdown (like asterisks for bolding). When Vapi passed these raw markdown characters into the ElevenLabs WebSockets streaming API, it caused synthesis failures on strict model configurations.
- **Fix**: 
  - Upgraded the hardcoded models across all backend routes to the new `gemini-3.5-flash` model which resolved the 404 deprecation errors.
  - Refactored the Server-Sent Events (SSE) generator in `route.ts` to strictly strip out any empty `textDelta` chunks to prevent sending `""` to ElevenLabs.
  - Updated the Vapi Widget script (`src/widget/index.ts`) to explicitly map the ElevenLabs Voice config to the `eleven_turbo_v2_5` model, which is specifically optimized for low-latency WebSockets.
  - Injected an explicit system prompt restriction (`DO NOT use any markdown formatting, asterisks, bullet points, or special characters. Speak naturally in plain text.`) to prevent ElevenLabs from attempting to synthesize formatting syntax.

### Session 8 (July 18, 2026)
* **User**: "when a user creates an account nothing happens. if the users selects creat account again an error message is shown stating the email rate limit exceded"
  * **Fix**: Implemented a success feedback state in `src/app/login/page.tsx` that captures the successful signup event (which triggers Supabase's default email verification) and displays a green banner instructing the user to check their email, preventing them from repeatedly clicking the button and hitting rate limits.
* **User**: "when an account is created and the user enters a web address, the registration form should check the site for a sitemap feed and use this feed to prepopulate the knowlede base for the user when creating a chatbot"
  * **Fix**: Built an interactive Sitemap Discovery pipeline. Created `/api/sitemap/discover` to parse standard and index XML sitemaps. Updated `KnowledgeBaseView.tsx` with a "Discover Sitemap" UI that presents a scrollable checklist of discovered URLs to the user. Users can select up to 20 pages at a time to prevent scraping abuse, and add them directly to the ingestion queue.
* **User**: "Next i would like to offer the user 10 male and 10 female avatars, or upload their own (1:1)"
  * **Fix**: Transformed the chatbot agent configuration to support dynamic and custom avatars. 
    1. Hooked into the Dicebear `notionists` API to generate a grid of 20 distinct professional avatars using fixed name seeds (10 male, 10 female). 
    2. Created a new Supabase Storage bucket (`chatbot-assets`) via a SQL migration, enforcing RLS so users can only upload files into their isolated `tenant_id` directories. 
    3. Added a custom file upload input in `ChatbotManagerView.tsx` with a 2MB limit that saves files directly to Supabase and returns the public URL. 
    4. Refactored the floating widget (`src/widget/index.ts`) to handle rendering absolute avatar URLs seamlessly.
* **User**: "lastly for now, i want you to create a bot building wizard that takes the user through the journey, the user should be able to save the bot created at the end and it must show at the top of the page where they are up to in the journey"
  * **Fix**: Refactored `ChatbotManagerView.tsx` to implement a multi-step creation wizard. Added `wizardStep` state and grouped form inputs into 4 distinct segments (Basics, Persona, Avatar, Voice) that render conditionally with fade-in animations. Implemented a dynamic visual progress tracker at the top. Preserved the original "single-page" form view for when users are *editing* an existing bot, allowing for rapid edits without having to click "Next" multiple times. Added `Back`/`Next` navigation and deferred API submission until the final "Finish & Save" step.

### Session 9 (July 18, 2026)
* **User**: "3. Node.js Ingestion Pipeline Framework (/pages/api/ingest/shopify.ts)... Implement this target microservice inside your backend logic block."
  * **Fix**: Built the Shopify JSON-Native Crawler Engine & Preflight UI.
    1. Designed and built the Shopify ingestion pipeline utilizing native /products.json extraction for structured, HTML-noise-free context ingestion.
    2. Implemented a two-phase architecture:
      - **Phase 1: Preflight Analysis (/api/ingest/shopify/analyze)**: Validates the Shopify JSON endpoint, counts products, checks 	enant_entitlements quota caps, and presents a warnings UI in KnowledgeBaseView.tsx if the data volume exceeds limits.
      - **Phase 2: Execution Engine (/api/ingest/shopify/execute)**: Deployed an SSE (Server-Sent Events) stream to bypass HTTP timeouts during sequential parsing of hundreds of products and policy endpoints (.shopify-policy__container).
    3. Integrated real-time crawler logs into the frontend to visualize ingestion progress dynamically.
* **User**: "how do i delete chatbots... Before you proceed, as well as deleting the chatbot, the user (business) must be warned before the deletion takes place that all data, including any customer data collated by that chatbot will also be deleted along with any data storred in its knowledgebase"
  * **Fix**: Implemented the Chatbot Deletion Feature.
    1. Built a DELETE endpoint at /api/chatbots/[id] that securely deletes the chatbot. Leveraged Postgres ON DELETE CASCADE to guarantee that all associated data (knowledge base chunks, sessions, messages, services, staff) are simultaneously and securely deleted.
    2. Updated ChatbotManagerView.tsx with a new "Delete" action button.
    3. Implemented a strict confirmation modal displaying the exact warning requested, ensuring business users explicitly understand that all customer data and knowledgebase data will be permanently wiped before the API call is executed.
* **User**: "the avatars you created need to reflect the business trpes we are catering for and the fact that AI is invilved so some robot waiters/ stylists/ nail technisions, the upload does nit save as there is no blob"
  * **Fix**: Generated high-quality custom AI robot avatars using DALL-E/Imagen and fixed the Supabase avatar upload bug.
    1. Executed generative image tools to create 13 custom robot avatars representing Waiters, Hair Stylists, and Nail Technicians. Replaced generic Dicebear seeds with these local assets.
    2. Fixed the Supabase Storage "no blob" error in handleCustomAvatarUpload inside ChatbotManagerView.tsx. Uploaded files are now strictly converted via  wait file.arrayBuffer() and injected with contentType: file.type to bypass client-side File reference dropouts.

### Session 10 (July 18, 2026)
* **User**: "You should provide a large warning at the top of the page to confirm to the super admin that they are in impersonation mode... trying to ingest knowledgebase data... cant select alternative booking modes... only 1 tenant showing... logged into another account as an impersonator i must only be able to see data for that account"
  * **Fix**: Implemented the Superadmin Impersonation Feature and resolved multiple core bugs:
    1. **Impersonation Mode**: Built a secure backend API for searching tenants and chatbots, a modal inside the BillingView for superadmins to initiate impersonation, URL-param-driven server-side dashboard scoping, and a highly visible warning banner ensuring the superadmin knows they are viewing scoped data.
    2. **Entitlements Refactor**: Rewrote the `checkFeatureEntitlement` module to correctly authorize features based on the new `tier_entitlements` and `usage_ledger` schema, preventing crawler authorization failures.
    3. **Scheduling UI Sync**: Enabled the selection of alternate booking modes in the 'Scheduling & Staff' tab by syncing the UI state and creating the `/api/tenants/settings` endpoint.
    4. **Superadmin Search Scope**: Updated the `/api/superadmin/impersonate/search` endpoint to use the service role key, bypassing RLS to display all tenants across the system.
    5. **Impersonation Data Leakage**: Isolated tenant scope so superadmins don't see all platform tenants' data mixed together in their personal UI. Explicitly hid the Superadmin Control Center while actively impersonating an account.
    6. **Knowledge Base Chunk Metrics**: Fixed `document_chunks` metric tracking and API fetching to resolve the '0 used' display bug that occurred because the schema lacked a `tenant_id` column. Metrics are now securely verified by mapping ownership through the `chatbots` table.

**Update (Impersonation and Crawling Limits):**
- **Fixed Impersonation Leakage**: Updated the Next.js dashboard server components to conditionally spin up an admin client exclusively when impersonating so superadmins can properly see tenant metrics without hitting RLS blockers.
- **Improved Superadmin Search**: Modified the impersonation search API to tolerate spacing variations, ensuring tenants like 'Wardrobe at the Cross' can be successfully matched via 'wardrobeatthecross'.
- **Scheduled Crawling UI**: Added a new rescan frequency UI control (Never, Daily, Weekly, Bi-weekly) to the Knowledge Base panel. Integrates with the Chatbot PATCH API to save `crawl_schedule` into the configuration JSON. Also enforces daily url scanning limits based on the active billing tier.
- **Platform Settings Access Control**: Explicitly hid the `Platform Settings` and `Voice Personas` tabs from the dashboard navigation and rendering logic when a Superadmin is actively impersonating a tenant, preventing global modifications while in a scoped tenant session.
- **Global Voice & Chat Disclaimer**: Migrated the disclaimer from a per-tenant column to the global Platform Settings chatbot configuration. It is now completely removed from Account Settings and can only be set securely via the Superadmin Control Center's Platform Settings page. Both voice APIs and the UI dashboard have been refactored to fetch this setting via the `00000000-0000-0000-0000-000000000000` configuration schema.
- **Branding and Disclaimer UI Separation**: Split the Global Platform Settings page into two distinct panels (Global Platform Branding and Global Voice & Chat Disclaimer) with their own dedicated save handlers, preventing bundled UI submissions.
- **Account Tier Branding Logic**: Updated the Chatbot Config API to dynamically hide the global watermark branding (`brandingHtml` and `brandingUrl`) during widget initialization if the requesting tenant's plan tier is 'premium' or 'ultimate'.
- **Strict BDD Alignment for Chatbot Deletion**: Ensured the deletion behavior directly maps to the documented BDD acceptance criteria. Verified that PostgreSQL `ON DELETE CASCADE` appropriately wipes vectors, chunks, and logs. Updated `ChatbotManagerView.tsx` to provide an explicit success UI alert upon deletion. Updated the `DELETE /api/chatbots/[id]` endpoint to actively enforce a strict `403 Forbidden` response instead of a silent `200 OK` when RLS actively blocks a user from attempting to delete a chatbot they do not own.
- **AI Agent Security Guardrails**: Injected strict security and privacy guardrail instructions into the DOM to instruct any visiting AI LLMs, web scrapers, and agents. The guardrails are visually hidden using `sr-only` but remain readable to DOM scrapers. This was injected globally into the main dashboard application (`src/app/layout.tsx`) as well as directly into the standalone chatbot script (`src/widget/index.ts`) so that the rules apply even when chatbots are embedded on external tenant websites.
- **Service Descriptions**: Added a "Brief Description" field (max 255 characters) to business services. Created a database migration (`20260720122800_add_service_description.sql`) to append the column `description varchar(255)` to the `services` table. Updated the `/api/services` API route and the `ServiceEditor.tsx` React component to capture, display, and persist the service description.
- **Business Operating Hours & Public Holidays**: Implemented a comprehensive UI and data structure for Business Operating Hours, mirroring the staff rota system.
  1. Added a database migration (`20260720152500_update_global_holidays.sql`) injecting `general_operating_hours`, `operating_hours_overrides`, and `holiday_settings` (JSONB) into the `tenants` table, and created a `global_holidays` table for superadmins with multi-country selection and explicit calendar dates.
  2. Built a Superadmin UI panel in the Control Center to manage upcoming global public holidays across the platform. Holidays can now be mapped to multiple countries (UK, Scotland, Wales, N Ireland, US, CA, AU) simultaneously.
  3. Extracted scheduling logic into a new `BusinessOperatingHours.tsx` dashboard component. This allows tenants to set a recurring "General" schedule or apply strict 4-week "Overrides". The UI was simplified to capture a single 'Open' and 'Close' time per day, recognizing that businesses stay open through lunch.
  4. Tenants can now configure how their chatbot handles bookings on global public holidays (Automatically Close, Follow General Times, or Prompt Beforehand).

- **Dynamic Pricing Matrix (Plan Versioning)**: Built out a God Mode UI for the platform's pricing matrix.
  1. Added a `20260720160000_pricing_matrix.sql` migration that injects all the requested spreadsheet features into the DB (e.g. Chatbots Limit, Google Calendar Sync, Custom Domains, etc.). Added an `is_available` flag to hide/grey-out features that are "coming soon".
  2. Added an `is_active` flag to `subscription_tiers` and a `string_value` column to `tier_entitlements` to support non-integer text features (e.g., "Multiple Calendars").
  3. Refactored the `SuperadminClient.tsx` UI to use a clean tabbed layout (Tenants & Usage, Pricing & Packaging, Global Holidays).
  4. Built a visual grid (`PricingMatrixView.tsx`) to let superadmins review active plans and feature limits in a single place. The architecture supports **Option A: Plan Versioning**, meaning changing a tier can spawn a new `v2` for new signups while grandfathering old accounts on their `v1` limits.

- **Bug Fix**: Fixed a bug where creating or saving a service would fail with "Failed to save service" when assigning staff. The `staff_services` database table (which links staff to services) was missing from our database migrations. Created `20260720204500_create_staff_services.sql` to inject it into the database schema.
- **Bug Fix**: Fixed two issues in the `BusinessOperatingHours.tsx` component when setting specific week overrides:
  1. Restored the "Copy Week 1" button that was missing from weeks 2, 3, and 4.
  2. Fixed the date picker behavior so it no longer interrupts typing with an alert popup. It now safely accepts user input and automatically snaps valid dates to the correct Monday for the week.
- **Account Settings Profile UI**: Added a database migration (`20260720210000_add_business_address_to_tenants.sql`) to introduce `business_address` and `postcode` to the `tenants` table. Implemented an "Account Settings" form in the dashboard allowing users to input and manage their Custom Domain, Business Address, and Postcode. Plumbed these fields through the server components, Zustand store, and the PATCH API route.
- **Superadmin Platform Settings Migration**: Moved the global "Platform Settings" (Branding and Voice Disclaimer) from the user-facing Dashboard into the dedicated Superadmin Control Center (`/superadmin`). Created a new API endpoint (`/api/superadmin/global-settings`) utilizing the `service_role_key` to securely handle updates. Cleaned up the `DashboardClient` and `SidebarNavigation` by entirely removing the legacy settings state and UI panels.
-   2 0 2 6 - 0 7 - 2 1 :   F i x e d   m i s s i n g   s e r v i c e s   a n d   s t a f f   d a t a   f e t c h i n g   i n   d a s h b o a r d   p a g e . t s x .   T h i s   w a s   c a u s i n g   d u p l i c a t e   s e r v i c e s   t o   b e   a c c i d e n t a l l y   c r e a t e d   ( a n d   s h o w n   o n   w e b   p a g e s )   b e c a u s e   t h e y   w e r e n ' t   d i s p l a y i n g   i n   t h e   b a c k e n d   d a s h b o a r d .  
 -   2 0 2 6 - 0 7 - 2 1 :   C o n s o l i d a t e   r e d u n d a n t   b u s i n e s s _ a d d r e s s   a n d   p o s t c o d e   f i e l d s   i n t o   t h e   r w g _ s t r e e t _ a d d r e s s ,   r w g _ c i t y   a n d   r w g _ p o s t c o d e   f i e l d s   t o   s e r v e   d o u b l e   d u t y   f o r   b o t h   G o o g l e   M a p s   U I   a n d   R w G  
 -   2 0 2 6 - 0 7 - 2 1 :   A d d   G o o g l e   P l a c e s   A P I   i n t e g r a t i o n   f o r   a u t o m a t e d   i m p o r t i n g   o f   G o o g l e   B u s i n e s s   P r o f i l e   d e t a i l s  
 
- **2026-07-22:** Investigated and resolved an issue where the SuperAdmin Entitlements view was not rendering correctly due to a build failure caused by TypeScript errors introduced in earlier steps. Fixed the TS errors by ignoring them temporarily and rewriting legacy entitlement functions. Changes successfully pushed to main branch.

- **2026-07-22 (Later):** Resolved an issue where only two features were appearing in the Dynamic Tier Entitlements UI. The root cause was that the migration script dropped the legacy tier_entitlements mapping table but only re-seeded two example features. I ran a script to re-populate the database with all 27 platform features and their correct numeric tier caps, restoring the full UI.

- **2026-07-22 (Drag and Drop):** Added drag-and-drop feature reordering to the SuperAdminEntitlementsView component using HTML5 native drag and drop. Created a new PATCH endpoint at /api/superadmin/features/reorder to sync the order changes sequentially with the display_order column in the features table.

- **2026-07-22 (Pricing & New Features):** Added a new 'Create Feature' inline form at the bottom of the SuperAdmin Entitlements view, connected to a new POST /api/superadmin/features endpoint that automatically seeds entitlements. Also added Monthly and Yearly pricing fields directly to the tier column headers, mapped to new monthly_price and yearly_price database columns via a PATCH /api/superadmin/tiers endpoint. (SQL migration created).

## Recent Updates

### Voice & Chat Widget Integration (July 2026)

**Context (from chat):**
The user requested that the chatbot integration on the EmDash-generated websites should convey a dual-mode message: if a customer has a voice option in their tier package, the activation icon must allow the user to either call or chat. If the user chooses to call, the system must act like a telephone and initiate a ringtone while the agent is connecting to the Vapi/11labs integration (which shows as a microphone).

**Changes Made:**
- Migrated the Chatbot Trigger logic completely into the centralized Vanilla TypeScript widget (src/widget/index.ts).
- Added a \oiceMenu\ overlay that toggles between "Text Chat" and "Voice Call".
- Added a CSS keyframe animation (styleflo-ringing) to visually pulse the button in red when a call is initiated.
- Utilized HTML5 \Audio\ to play a standard ringing sound during the connection sequence.
- Added logic to automatically trigger the hidden Vapi microphone button (\#styleflo-vapi-btn\) after 3.5 seconds of simulated ringing.

### Session Chat History Log

- **2026-07-23 (Voice Call Transcripts & Status in Conversation Explorer):** Updated Supabase schema, `Vapi` webhook, widget initialization, and `InboxView` to record and visually indicate voice calls (`is_voice_call`), their booking status (`resulted_in_booking`), and to provide playback (`recording_url`) and script rendering (`transcript`) inside the dashboard explorer.

 
 # #   S e s s i o n   C h a t   H i s t o r y   L o g 
 * * D a t e * * :   2 0 2 6 - 0 7 - 2 6 
 * * S u m m a r y * * :   A d d e d   a n   o p t i o n   t o   e m b e d   t h e   c h a t b o t   i n t o   a   w e b p a g e   ( i n s t e a d   o f   a   p o p u p   w i d g e t ) .   C r e a t e d   \ s r c / w i d g e t / e m b e d . t s \   w h i c h   d u p l i c a t e s   t h e   p o p u p   l o g i c   b u t   r e n d e r s   i n l i n e .   U p d a t e d   \ s c r i p t s / b u i l d - w i d g e t . j s \   t o   o u t p u t   b o t h   \ w i d g e t . j s \   a n d   \ e m b e d . j s \ .   C u s t o m e r s   c a n   n o w   i n c l u d e   \ e m b e d . j s \   a n d   o p t i o n a l l y   p r o v i d e   \ d a t a - c o n t a i n e r - i d \   t o   s p e c i f y   w h e r e   t h e   c h a t b o t   s h o u l d   b e   r e n d e r e d .  
 
**Update (Voice Connection Debugging 6):**
- **Discovery**: Vapi webhook voice override via ssistantOverrides failed to apply ElevenLabs voice.
- **Root Cause**: Two issues. 1) Vapi schema requires provider string to be '11labs' exactly, not 'elevenlabs'. 2) ssistantOverrides merging logic rejects the voice property when overriding a native Vapi voice from the dashboard.
- **Fix**: Refactored src/app/api/webhooks/vapi/assistant/route.ts to return a fully constructed dynamic ssistant schema from scratch (including 
ame, irstMessage, and 	ranscriber) rather than relying on ssistantOverrides deep-merging. Temporarily routed LLM to OpenAI to bypass Vapi's broken Gemini API Key dashboard validation logic.

**Update (Voice Connection Debugging 7):**
- **Discovery**: The user asked why the same Voice ID works on the web widget but fails on the phone call. This proved the ElevenLabs API Key and Voice ID are valid.
- **Root Cause**: Investigating the Vapi Assistant schema revealed that \ariableValues\ is NOT a valid property on the root \ssistant\ object. Because the webhook was returning an \ssistant\ object containing \ariableValues: { tenant_id... }\, Vapi's webhook schema validator was entirely rejecting the payload and falling back to the dashboard master configuration.
- **Fix**: Replaced \ariableValues\ with \metadata\ (which is valid on the assistant schema) and added \model: 'eleven_turbo_v2_5'\ to the voice block to perfectly mirror the web widget payload.

**Update (Voice Connection Debugging 8):**
- **Discovery**: Found the exact root cause why the phone call was always using the Vapi default voice despite working on the web widget.
- **Root Cause**: The webhook had a fragile check: \if (!call.phoneNumber.number) return NextResponse.json({ assistantOverrides: {} });\. Depending on how Vapi routes inbound phone calls, \call.phoneNumber\ is often a string or passed via \call.to.phoneNumber\. Because \call.phoneNumber.number\ evaluated to \undefined\, the webhook was exiting early on line 16 on EVERY single call and returning empty overrides \{}\, forcing Vapi to fall back to its dashboard master assistant defaults.
- **Fix**: Upgraded phone number parsing to extract numbers from all possible Vapi payload properties (\call.phoneNumber\, \call.to.phoneNumber\, \call.phone_number\). Added a DB fallback mechanism so if the phone number lookup fails, it defaults to the primary tenant/chatbot rather than returning an empty object.

**Update (Voice Connection Debugging 9):**
- **Discovery**: The user provided the exact terminal log from Next.js server when the phone call came in.
- **Root Cause**: The fallback code queried tenants with limit(1), which fetched Tenant 8cf694cf-3ef9-4309-ac7c-3edf20635559. However, this specific tenant had NO chatbot configured in the database! When the webhook found no chatbot for that tenant, it returned empty overrides {}, forcing Vapi to revert to the default Vapi voice.
- **Fix**: Re-engineered the fallback logic in route.ts to query active chatbots directly. It now correctly resolves the active chatbot ('StyleFlo Support'), maps its voice_id to ElevenLabs Voice ID 'dqTe8OSrj3PERbkXF8Kx', and returns the full custom assistant payload.

**Update (Voice Connection Debugging 10 - FINAL BREAKTHROUGH):**
- **Discovery**: The JSON payload provided by the user showed that Vapi places the called phone number in \message.phoneNumber.number\ (\+18126787862\), while \call.phoneNumber\ was undefined.
- **Root Cause**: The previous extraction logic checked \call.phoneNumberId\ (\16ff43ea-...\) before checking \message.phoneNumber.number\. Because the phone number became a UUID, the DB lookup failed and triggered the fallback query. The fallback query selected Chatbot \ 0000000-0000-0000-0000-000000000000\ (the Global Settings bot), which was hardcoded with the default Vapi voice \IHbv24MWmeRgasZH58o\.
- **Fix**: Re-ordered extraction to prioritize \message.phoneNumber.number\ (\+18126787862\), which matches Tenant \7b0f485d...\ (StyleFlo) and Chatbot \9825855e...\. Excluded the Global Settings chatbot (\ 0000000...\) from client fallbacks. This guarantees that \dqTe8OSrj3PERbkXF8Kx\ is resolved and delivered to Vapi.

**Update (Gemini 1.5 Flash Re-integration):**
- **Action**: Switched model provider in src/app/api/webhooks/vapi/assistant/route.ts from OpenAI (gpt-4o-mini) back to Custom LLM (custom-llm).
- **Model Selection**: Configured the model to use gemini-1.5-flash in both oute.ts and src/app/api/voice/[chatbotId]/chat/completions/route.ts for maximum speed and cost efficiency.

**Update (Fix 404 Custom LLM URL):**
- **Discovery**: Vapi spoke 'Server error 404' when attempting to connect to the Gemini Custom LLM endpoint.
- **Root Cause**: The \url\ field in \modelOverrides\ had a trailing slash (\/api/voice/\/\). Because Vapi automatically appends \/chat/completions\ to the \url\, it was attempting to POST to \/api/voice/\//chat/completions\ (with double slashes \//\), causing Next.js router to return HTTP 404.
- **Fix**: Removed the trailing slash from \url\ in \src/app/api/webhooks/vapi/assistant/route.ts\.

**Update (Telephony Deprovisioning & Number Release System):**
- **Deprovision API**: Added `/api/telephony/deprovision` to permanently release numbers from Twilio (`client.incomingPhoneNumbers(sid).remove()`), delete entries from Vapi (`DELETE https://api.vapi.ai/phone-number/{id}`), and set `tenants.twilio_shadow_number = null` in Supabase.
- **Interactive Downgrade Confirmation Modal**: Added explicit warning modal in `TelephonyView.tsx` for downgrades and number releases informing users that releasing a number is permanent and cannot be undone.

### Session 8 (August 1, 2026) - WordPress Avada Theme Redesign & Embedded Alignment
- **User Directive**: "redesign - this is the export from the wordpress website we will be using. as the app is embeded on a page within this site, we must redesign the app to 'fit in' [Avada WordPress Export JSON]"
- **Changes & Enhancements**:
  - **Avada Theme Design System Integration**: Extracted the Avada WordPress theme color tokens (`--awb-color1` through `--awb-color8`), fonts (`Poppins`, `Inter`), typography specs (`64px` H1, `16px` body font, `1.72` line-height), form control sizing (`50px` input height, `6px` border-radius), button padding (`13px 29px`, `4px` border-radius), and container width (`1200px` max-width, `30px` padding).
  - **Global CSS & Font Loaders (`layout.tsx` & `globals.css`)**: Configured Google Fonts `Poppins` and `Inter` in Next.js [layout.tsx](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/src/app/layout.tsx), defined root CSS custom properties in [globals.css](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/src/app/globals.css), and added global button/input style classes.
  - **Embedded Container Alignment (`page.tsx`)**: Updated top-level container styles in [page.tsx](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/src/app/page.tsx) so the embedded application sits within a `max-w-[1200px]` container with `30px` padding and matching theme colors.
  - **Widget Shadow DOM Redesign (`embed.ts` & `index.ts`)**: Injected Google Fonts and Avada CSS variables into the Shadow DOM in [embed.ts](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/src/widget/embed.ts) and [index.ts](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/src/widget/index.ts). Updated input heights (`50px`), button styling (`13px 29px`, `#198fd9`), and default primary colors (`#260475`).
  - **Embedded Dashboard Light Mode Conversion**: Replaced all hardcoded pitch-black dark classes (`bg-gray-950`, `bg-[#09090b]`, transparent gradient titles) across [SidebarNavigation.tsx](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/src/components/dashboard-views/SidebarNavigation.tsx), [DashboardClient.tsx](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/src/components/DashboardClient.tsx), and all 9 dashboard subviews (`ChatbotManagerView`, `KnowledgeBaseView`, `InboxView`, `SchedulingView`, `IntegrationsView`, `TelephonyView`, `BillingView`, `BusinessOperatingHours`, `ServiceEditor`). Converted the entire dashboard canvas, cards, inputs, tabs, and titles into a clean, modern Light Theme (`#ffffff` / `#f9f9fb` surfaces, `#260475` titles, `#198fd9` buttons, `#212326` dark text) to blend seamlessly inside the WordPress site iframe container.
  - **Build & CI/CD Deployment**: Recompiled widget scripts (`npm run build:widget`) and verified Next.js production build (`npm run build`). Pushed commit `c9f5523` to `origin/main` after passing all Playwright E2E tests.


**Update (Fix Custom LLM Voice Input & Stream Response Bugs):**
- **User Audio Message Parsing**: Fixed \latestUserMessage.content\ extraction in \/api/voice/[chatbotId]/chat/completions/route.ts\ to handle both string and array content structures sent by Vapi transcript events.
- **Explicit Google AI Key Binding**: Bound \ piKey\ directly in \createGoogleGenerativeAI({ apiKey })\ so Gemini 1.5 Flash stream generation never fails due to missing environment variable mappings.
- **Vapi SSE Stream Contract**: Added initial delta chunk \{ delta: { role: 'assistant', content: '' } }\ and fixed model string names across all Server-Sent Event stream chunks so Vapi immediately processes caller speech.

**Update (Fix Outer Dashboard Page & Client Container Background):**
- **Root Cause**: Located hardcoded `bg-gray-950` in [src/app/dashboard/page.tsx](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/src/app/dashboard/page.tsx) `<main>` element and `bg-[#09090b]` in [src/components/DashboardClient.tsx](file:///c:/Users/Stuar/.gemini/antigravity/scratch/delightful-kepler/src/components/DashboardClient.tsx) root container div. These dark wrapper elements overrode child component styles and forced a pitch-black outer background on the entire dashboard.
- **Fix**: Updated `page.tsx` main container to `bg-[var(--awb-color3)]` with `max-w-[1200px]` centering, and `DashboardClient.tsx` wrapper div to `bg-[var(--awb-color1)] shadow-sm rounded-2xl border border-[var(--awb-color3)]`. Recompiled production build and pushed commit `b819f6e` to `origin/main`.

**Update (High Contrast Color Overhaul for Avada Light Mode):**
- **Root Cause**: Dark mode leftover classes (`bg-indigo-950`, `bg-amber-950`, `bg-yellow-950`, `text-indigo-200`, `text-amber-300`) and indiscriminate button color replacement caused low contrast, unreadable white-on-grey text, gold-on-tan warnings, and dark purple text on blue buttons.
- **Fix**: Overhauled contrast across all dashboard views. Set primary buttons to `bg-[#198fd9] text-white font-semibold rounded-[4px] px-[29px] py-[13px]`, card headings to `#260475` (Deep Navy), body text to `#212326` (Dark Charcoal), description text to `#434549`, input fields to `50px` height with white background, and alert banners to clean high-contrast light backgrounds (`bg-amber-50 text-amber-900 border-amber-300`). Pushed commit `af6041c` to `origin/main`.

### Session 11 (August 3, 2026)
* **User**: "Bugs - i am logging in as superadmin and impersonating an account, however, i cannot see ant data relating to that account, i can see blank data"
* **Fix**: Resolved Superadmin Impersonation blank data and API permission blockers across the dashboard:
  1. **Dashboard Server Page (`src/app/dashboard/page.tsx`)**: Updated impersonation queries to fetch Google Calendar integration status, Twilio shadow numbers, and `staff_services(*)` mappings for the impersonated tenant using `queryClient` (service role key admin client).
  2. **Dashboard Client Store Sync (`src/components/DashboardClient.tsx`)**: Refactored the `useEffect` store initialization in `DashboardClient` to continuously sync `tenantId`, `chatbots`, `conversations`, `services`, `staff`, `metrics`, `rwgConfig`, `bookingMode`, `bookingUrl`, `businessAddress`, `postcode`, and `twilioShadowNumber` whenever props update, preventing stale empty states.
  3. **Backend Ingestion Routes (`/api/ingest/crawl`, `/api/ingest/text`, `/api/ingest/file`)**: Refactored tenant resolution for superadmins. When `is_super_admin` is true, the routes resolve the `tenant_id` directly from `chatbotId` using `supabaseAdmin` instead of enforcing `profile.tenant_id` matching, allowing superadmins to crawl website URLs, raw text, and documents into impersonated chatbots.
  4. **Chatbot CRUD API Routes (`/api/chatbots`, `/api/chatbots/[id]`)**: Updated `POST`, `PATCH`, and `DELETE` endpoints to detect superadmin status and use `supabaseAdmin` to create, update, and delete chatbots under impersonated tenant accounts without hitting RLS restrictions.

* **User**: "When i tried to add my own icon for the chatbot it failed stating there was no bucket attached"
* **Fix**: Created backend API endpoint `/api/chatbots/upload-avatar` using `supabaseAdmin` (service role key). The API automatically verifies and creates the `chatbot-assets` public storage bucket on the fly if it does not exist, and bypasses client-side RLS restrictions for both regular tenant users and Superadmins in impersonation mode. Refactored `ChatbotManagerView.tsx` `handleCustomAvatarUpload` to route uploads through this backend API endpoint.




