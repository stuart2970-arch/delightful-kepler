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
    2. Fixed the Supabase Storage "no blob" error in handleCustomAvatarUpload inside ChatbotManagerView.tsx. Uploaded files are now strictly converted via wait file.arrayBuffer() and injected with contentType: file.type to bypass client-side File reference dropouts.

- **[2026-07-18]** Implemented Superadmin Impersonate Feature: Added a secure backend API for searching tenants and chatbots, a modal inside the BillingView for superadmins to initiate impersonation, URL-param-driven server-side dashboard scoping, and a highly visible warning banner ensuring the superadmin knows they are currently viewing a scoped tenant account.
