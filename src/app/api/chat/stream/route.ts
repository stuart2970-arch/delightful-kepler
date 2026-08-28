
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { streamText, embed, tool } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { checkAvailability, bookMeeting, lookupAppointments } from './calendar';
import { sendConsolidatedLeadEmail } from '@/lib/lead-notifier';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-session-token, x-turnstile-token, authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: corsHeaders,
  });
}

// Input validation schema
const ChatRequestSchema = z.object({
  message: z.string().min(1, { message: 'Message cannot be empty' }),
  chatbotId: z.string().min(1, { message: 'Chatbot ID cannot be empty' }),
  sessionId: z.string().min(1, { message: 'Session ID cannot be empty' }),
  clientName: z.string().optional().nullable(),
});

// Initialize Supabase Admin Client using service role key (bypasses RLS for service logic)
function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  console.log(`[Chat Stream][${requestId}] Inbound chat request...`);

  // Map GEMINI_API_KEY to GOOGLE_GENERATIVE_AI_API_KEY for the @ai-sdk/google provider
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  try {
    // 1. Check env configuration
    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    if (!geminiApiKey) {
      console.error(`[Chat Stream][${requestId}] GEMINI_API_KEY environment variable is missing`);
      return NextResponse.json({ error: 'Gemini integration misconfigured: missing API key' }, { status: 200, headers: corsHeaders });
    }

    const google = createGoogleGenerativeAI({
      apiKey: geminiApiKey,
    });

    const supabaseAdmin = getSupabaseAdmin();

    // 2. Validate request body
    const body = await request.json();
    const validation = ChatRequestSchema.safeParse(body);

    if (!validation.success) {
      const errorMsg = validation.error.issues.map((issue) => issue.message).join(', ');
      console.warn(`[Chat Stream][${requestId}] Validation failed: ${errorMsg}`);
      return NextResponse.json({ error: `Validation error: ${errorMsg}` }, { status: 200, headers: corsHeaders });
    }

    const { message, chatbotId, sessionId, clientName } = validation.data;
    console.log(`[Chat Stream][${requestId}] Chatbot ID: ${chatbotId}, Session ID: ${sessionId}, Client: ${clientName || 'Unknown'}`);

    // 3. Resolve tenant_id & configuration
    let tenantId = '00000000-0000-0000-0000-000000000000';
    let configData: Record<string, unknown> = {};

    if (chatbotId === 'styleflo-onboarding-flobot') {
      configData = {
        agent_name: 'Flo',
        agent_role: 'StyleFlo AI Receptionist Builder',
        welcome_message: "Hi, I'm Flo! I'm your StyleFlo AI assistant builder. Let's create your account and get your AI receptionist ready in under 60 seconds!",
        system_instruction: `You are Flo, the official AI onboarding assistant for StyleFlo.ai. 
Your goal is to guide new salon/spa owners through a fast, friendly 60-second conversational onboarding journey.
Help them specify:
1. Business/Salon Name
2. Salon Services offered (e.g., Haircuts, Coloring, Styling, Nails, Balayage)
3. Owner's Name & Contact Details

Be encouraging, warm, professional, concise, and helpful! Advise them they can also click the "Continue with Google" button above for instant 1-Click calendar connection!`,
      };
    } else {
      const { data: chatbot, error: chatbotError } = await supabaseAdmin
        .from('chatbots')
        .select('tenant_id, configuration_json')
        .eq('id', chatbotId)
        .single();

      if (chatbotError || !chatbot) {
        console.warn(`[Chat Stream][${requestId}] Chatbot validation failed or not found:`, chatbotError);
        return NextResponse.json({ error: `Chatbot not found: ${chatbotError?.message}` }, { status: 200, headers: corsHeaders });
      }

      tenantId = chatbot.tenant_id;
      configData = (chatbot.configuration_json as Record<string, unknown>) || {};
    }
    const timezone = (configData.timezone as string) || 'Europe/London';
    const currency = (configData.currency as string) || 'GBP';
    
    // Extract Chatbot Rules
    const rawRules = configData.chatbot_rules;
    let chatbotRules: string[] = [];
    if (Array.isArray(rawRules)) {
      chatbotRules = rawRules.map((r: any) => String(r).trim()).filter(Boolean);
    } else if (typeof rawRules === 'string') {
      chatbotRules = rawRules.split('\n').map((r: string) => r.trim()).filter(Boolean);
    }

    const rulesSection = chatbotRules.length > 0
      ? `\n\n[MANDATORY CHATBOT RULES & DIRECTIVES]\nYou MUST strictly adhere to and enforce all of the following rules set by the business in every response:\n${chatbotRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
      : '';

    console.log(`[Chat Stream][${requestId}] Resolved Tenant ID: ${tenantId}, TZ: ${timezone}, Rules count: ${chatbotRules.length}`);

    // 4. Generate user message embedding (Gemini text-embedding-004)
    console.log(`[Chat Stream][${requestId}] Creating user message embedding...`);
    let queryEmbedding: number[];
    try {
      const { embedding } = await embed({
        model: google.textEmbeddingModel('gemini-embedding-001'),
        value: message,
        providerOptions: {
          google: {
            outputDimensionality: 768,
          },
        },
      });
      queryEmbedding = embedding;
    } catch (embeddingErr: unknown) {
      console.error(`[Chat Stream][${requestId}] Gemini embedding creation failed:`, embeddingErr);
      const errorMessage = embeddingErr instanceof Error ? embeddingErr.message : String(embeddingErr);
      return NextResponse.json({ error: `Embedding failed: ${errorMessage}` }, { status: 200, headers: corsHeaders });
    }

    const targetBotUuid = chatbotId === 'styleflo-onboarding-flobot' 
      ? '00000000-0000-0000-0000-000000000000' 
      : chatbotId;

    // 5. Query matching documents using the match_documents RPC (strictly filtered by tenant_id & chatbot_id)
    console.log(`[Chat Stream][${requestId}] Searching similarity index...`);
    let matchedDocuments: any[] = [];
    
    if (chatbotId !== 'styleflo-onboarding-flobot') {
      const { data: docs, error: rpcError } = await supabaseAdmin.rpc('match_documents', {
        query_embedding: queryEmbedding,
        match_threshold: 0.2, // retrieve broader content if close, similarity score threshold
        match_count: 4, // pull top 4 context chunks
        targeting_tenant_id: tenantId,
        targeting_chatbot_id: targetBotUuid,
      });

      if (rpcError) {
        console.error(`[Chat Stream][${requestId}] match_documents RPC failed:`, rpcError);
        return NextResponse.json({ error: `Context retrieval failed: ${rpcError.message}` }, { status: 200, headers: corsHeaders });
      }
      matchedDocuments = docs || [];
    }

    const contextText = matchedDocuments && matchedDocuments.length > 0
      ? matchedDocuments.map((doc: { content: string }) => `- ${doc.content}`).join('\n\n')
      : 'No context available.';
    
    // Fetch Services, Staff and Tenant Booking Mode for Calendar integration
    const [servicesRes, staffRes, tenantRes] = await Promise.all([
      supabaseAdmin.from('services').select('id, name, duration_minutes, buffer_minutes, price, staff_services(staff_id, custom_price, custom_duration)').eq('tenant_id', tenantId).eq('chatbot_id', targetBotUuid),
      supabaseAdmin.from('staff').select('id, name').eq('tenant_id', tenantId).eq('chatbot_id', targetBotUuid),
      supabaseAdmin.from('tenants').select('name, booking_mode, booking_url').eq('id', tenantId).maybeSingle()
    ]);
    const servicesContext = servicesRes.data ? JSON.stringify(servicesRes.data, null, 2) : '[]';
    const staffContext = staffRes.data ? JSON.stringify(staffRes.data, null, 2) : '[]';
    const bookingMode = tenantRes.data?.booking_mode || 'single_calendar';
    const bookingUrl = tenantRes.data?.booking_url || '';
    const businessName = configData.businessName || tenantRes.data?.name || 'this business';

    console.log(`[Chat Stream][${requestId}] Retrieved ${matchedDocuments?.length || 0} context documents and calendar config for ${businessName}.`);

    // 6. Get or create conversation record
    console.log(`[Chat Stream][${requestId}] Resolving conversation session...`);
    let conversationId: string = '00000000-0000-0000-0000-000000000000';

    if (chatbotId !== 'styleflo-onboarding-flobot') {
      const { data: conversation, error: convError } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('chatbot_id', targetBotUuid)
        .eq('user_session_id', sessionId)
        .maybeSingle();

      if (convError) {
        console.error(`[Chat Stream][${requestId}] Conversation query failed:`, convError);
        return NextResponse.json({ error: `Conversation query failed: ${convError.message}` }, { status: 200, headers: corsHeaders });
      }

      if (!conversation) {
        // Create new conversation session
        const { data: newConv, error: createConvError } = await supabaseAdmin
          .from('conversations')
          .insert({
            tenant_id: tenantId,
            chatbot_id: targetBotUuid,
            user_session_id: sessionId,
          })
          .select('id')
          .single();

        if (createConvError || !newConv) {
          console.error(`[Chat Stream][${requestId}] Conversation creation failed:`, createConvError);
          return NextResponse.json({ error: `Conversation creation failed: ${createConvError?.message}` }, { status: 200, headers: corsHeaders });
        }
        conversationId = newConv.id;
        console.log(`[Chat Stream][${requestId}] Initialized new conversation: ${conversationId}`);
      } else {
        conversationId = conversation.id;
        console.log(`[Chat Stream][${requestId}] Found existing conversation: ${conversationId}`);
      }
    }

    // 7. Retrieve chat history (last 20 messages)
    let recentHistory: any[] | null = null;
    if (chatbotId !== 'styleflo-onboarding-flobot') {
      const { data: history, error: historyError } = await supabaseAdmin
        .from('messages')
        .select('sender_type, text_content')
        .eq('conversation_id', conversationId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(20);
      recentHistory = history;

      if (historyError) {
        console.error(`[Chat Stream][${requestId}] Failed to fetch history:`, historyError);
      }
    }

    const chatHistory = recentHistory ? recentHistory.reverse() : [];

    // 8. Build prompt and historical message messages array
    const systemPrompt = chatbotId === 'styleflo-onboarding-flobot'
      ? `You are Flo, the official AI registration assistant for StyleFlo.
Your goal is to smoothly guide new business owners through account creation and setting up their AI Receptionist in under 60 seconds.

CRITICAL CONVERSATIONAL RULES:
1. NEVER REPEAT GREETINGS: Do not say "Welcome to StyleFlo!" or re-introduce yourself after the initial message.
2. NEVER ASK THE SAME QUESTION TWICE: Pay close attention to previous turns in the chat transcript. If the user already selected "email" or "google", or provided their business details, DO NOT re-ask or re-prompt for signup method.
3. SINGLE RESUMPTION CODE: Generate EXACTLY ONE resumption code (e.g., FLO-4921) when email signup is selected. NEVER generate a second resumption code (e.g. FLO-3921) in the same chat!
4. LINEAR PROGRESSION: Maintain a natural, fluid conversation without looping back.

Linear Onboarding Pipeline:
- STEP 1 (ENROLLMENT):
  - Initial greeting: "Hi, I'm Flo, your AI registration assistant! Tell me, would you prefer to sign up using your Google account or an email address? (The Google sign-in button is at the top of this chat, or pass me your email address to get started!)"
  - If user chooses Google: Remind them to click the "Continue with Google" button above.
  - If user chooses Email: Acknowledge their choice, ask for their email address (if not yet provided), and generate their single resumption code (e.g. "Great! Your secure resumption code is FLO-4921. What email address should we use?").
- STEP 2 (IDENTITY): Once email/identity is confirmed, confirm Google Places details (location & operating hours) OR ask for their City and service radius in miles.
- STEP 3 (INGESTION): Request their website URL/sitemap for automated knowledge ingestion OR option to upload a PDF price list / FAQ text.
- STEP 4 (LOGISTICS): Ask which booking operational mode fits best (Single Calendar, Multi Staff, Walk-In, or External Link).
- STEP 5 (LAUNCH): Congratulate them, provide their live testing link (https://styleflo.ai/business/[business-slug]), and invite them to test their bot before redirecting to the StyleFlo Dashboard!

User State: ${clientName ? `Signed in as ${clientName}` : 'Guest visitor'}`
      : `You are a friendly, conversational AI customer support assistant representing "${businessName}".
Use ONLY the following context to answer the user's query about "${businessName}". 
If you do not know the answer, politely state that you represent "${businessName}" and ask them to drop their email or phone number so a human agent can follow up.

STRICT BRAND PROTECTION RULE: You strictly represent "${businessName}". You are strictly forbidden from recommending, mentioning, or providing information about competitor businesses, competitor brands, or third-party alternatives under any circumstances.${rulesSection}

The current date and time is: ${new Date().toISOString()}. Use this to resolve relative dates like "tomorrow" or "next Sunday".

Guidelines:
- Write in a natural, warm, and human-like conversational tone.
- Use emojis occasionally to feel friendly.
- Use short paragraphs and avoid overwhelming the user with long blocks of text.
- If presenting multiple items, use clean bullet points.
- CRITICAL: Use the ${currency} symbol when quoting prices.
- CRITICAL: If the user explicitly types their email or phone number in the chat, you MUST end your response with exactly: [LEAD_CAPTURED: their_email_or_phone]. DO NOT use this tag to ask them for their info. Only use it when they actually provide it!
${bookingMode === 'walk_in_only' ? '- We DO NOT accept appointments. We are walk-ins only. If the user asks to book, politely inform them that they can just walk in at any time during our opening hours.' : ''}
${bookingMode === 'external_platform' ? `- We use an external booking platform. If the user asks to book, politely redirect them to our booking page: ${bookingUrl}` : ''}
${(bookingMode === 'single_calendar' || bookingMode === 'multi_calendar') ? `- CRITICAL SCHEDULING RULE 1 (STAFF SELECTION): If the user wants to book an appointment, identify the Service and any requested Staff member. If NO staff member is specified by the user, pass 'ANY' as the StaffID to check availability across ALL qualified staff members for that service.
- CRITICAL SCHEDULING RULE 1b (ALTERNATIVE STAFF OFFER): If the requested staff member (e.g. Jane) is UNAVAILABLE at the requested time slot (e.g. 10:00 AM), but ANOTHER qualified staff member (e.g. Stuart) IS available at 10:00 AM, DO NOT tell the user 10:00 AM is unavailable! Instead, politely offer the 10:00 AM slot with the available colleague (e.g., "Jane is booked at 10:00 AM, but Stuart is available at 10:00 AM! Would you like to book with Stuart, or choose a different time with Jane?").
- CRITICAL SCHEDULING RULE 1c (FUZZY SERVICE PATTERN MATCHING): Users will often state service requests using informal or varied phrasing (e.g., "assisted build", "build help", "setup assistance", "30 min chat"). You MUST search and match similar text patterns across all names and descriptions in SERVICES CONFIGURATION. Match to the most relevant service (e.g., "assisted build" -> "Assisted Setup"). Never default to an unrelated service!
- CRITICAL SCHEDULING RULE 1d (SERVICE & STAFF CONFIRMATION): Always state the exact service name, duration, and staff pricing options to the user to confirm their choice before checking availability or finalizing a booking. For example: "Just to confirm, you would like to book an Assisted Setup session? We have Jane available for 60 minutes, or Stuart for £75 for a quicker 45-minute session. Which would you prefer?"
- CRITICAL SCHEDULING RULE 2: Once you know the Staff ID (or 'ANY') and Service ID, you MUST check availability before confirming any slot. Reply with a polite conversational message, and append EXACTLY: [CHECK_AVAILABILITY: StaffID, ServiceID, StartDate, EndDate]. StartDate and EndDate should be ISO strings WITH the ${timezone} timezone offset (e.g., +01:00 for BST). 
- CRITICAL SCHEDULING RULE 3: Once you have checked availability and the user agrees to a specific available slot, you MUST ask for BOTH their email address AND their mobile phone number before booking.
- CRITICAL SCHEDULING RULE 4: Once you have both their email and mobile number, you MUST book it by responding with a polite message, and then append EXACTLY: [BOOK_MEETING: StaffID, ServiceID, CustomerName, CustomerEmail, CustomerPhone, StartTime, EndTime]. StartTime and EndTime must be precise ISO strings WITH the timezone offset.
- CRITICAL SCHEDULING RULE 5: When presenting available time slots to the user, you MUST output them using EXACTLY this format on its own line: [TIME_SLOTS: {"YYYY-MM-DD":["HH:MM", "HH:MM"]}]. Do not use markdown tables or bullet points for times. Example: [TIME_SLOTS: {"2026-07-06":["09:00","13:00"],"2026-07-07":["09:00","10:00"]}].
- CRITICAL SCHEDULING RULE 6: If the user asks to see their upcoming appointments, you MUST first politely ask them to confirm BOTH their email address AND their mobile phone number (for security reasons). Once you have both, reply with a polite message and append EXACTLY: [LOOKUP_APPOINTMENTS: CustomerEmail, CustomerPhone]. You are strictly forbidden from cancelling or modifying appointments; if they ask to cancel, tell them they must contact the business directly.
- CRITICAL: You MUST use exact UUID strings for StaffID and ServiceID from JSON configs (or 'ANY' for StaffID). Do NOT invent names or UUIDs!
- When outputting a secret tag like [CHECK_AVAILABILITY...] or [BOOK_MEETING...] or [TIME_SLOTS...] or [LOOKUP_APPOINTMENTS...], it MUST be the very last line of your response.` : ''}

Context:
${clientName ? `The customer's name is ${clientName}. Greet them by name if appropriate!` : ''}
[INJECTED CHUNKS]
${contextText}

[SERVICES CONFIGURATION (JSON)]
${servicesContext}

[STAFF CONFIGURATION (JSON)]
${staffContext}`;

    const formattedMessages: { role: 'user' | 'assistant', content: string }[] = [];
    if (chatHistory && chatHistory.length > 0) {
      chatHistory.forEach((msg) => {
        formattedMessages.push({
          role: msg.sender_type === 'user' ? 'user' : 'assistant',
          content: msg.text_content,
        });
      });
    }

    // Append current user message
    formattedMessages.push({
      role: 'user',
      content: message,
    });

    console.log(`[Chat Stream][${requestId}] Initializing Vercel AI SDK text stream (gemini-3.5-flash)...`);

    let lastApiError = "";
    
    // 9. Invoke streamText and setup async database transaction logging
    const result = await streamText({
      model: google('gemini-3.6-flash'),
      system: systemPrompt,
      messages: formattedMessages,
      onError: (err: unknown) => {
        console.error(`[Chat Stream][${requestId}] API Stream Error:`, err);
        lastApiError = err instanceof Error ? err.message : String(err);
      },
      onFinish: async (event) => {
        console.log(`[Chat Stream][${requestId}] AI stream finished. Logging conversation in background...`);
        try {
          if (chatbotId !== 'styleflo-onboarding-flobot') {
            // Explicit timestamps to guarantee order
            const now = Date.now();
            const userTime = new Date(now - 1000).toISOString();
            const botTime = new Date(now).toISOString();

            const userInsertRes = await supabaseAdmin.from('messages').insert({
              tenant_id: tenantId,
              conversation_id: conversationId,
              sender_type: 'user',
              text_content: message,
              created_at: userTime,
            });

            const cleanBotText = event.text.replace(/\[LEAD_CAPTURED:.*?\]/g, '').replace(/\[CHECK_AVAILABILITY:.*?\]/g, '').replace(/\[BOOK_MEETING:.*?\]/g, '').trim();
            
            let assistantInsertRes: { error: unknown | null } = { error: null };
            if (cleanBotText) {
              assistantInsertRes = await supabaseAdmin.from('messages').insert({
                tenant_id: tenantId,
                conversation_id: conversationId,
                sender_type: 'bot',
                text_content: cleanBotText,
                created_at: botTime,
              });
            }

            if (userInsertRes.error) console.error(`[Chat Stream][${requestId}] Failed to log user message:`, userInsertRes.error);
            if (assistantInsertRes.error) console.error(`[Chat Stream][${requestId}] Failed to log assistant response:`, assistantInsertRes.error);
          }

          // Handle consolidated lead capture notification (combining email & phone into 1 email with intent & transcript)
          const leadMatch = event.text.match(/\[LEAD_CAPTURED:\s*(.+?)\]/);
          if (leadMatch && leadMatch[1]) {
            const contactInfo = leadMatch[1];
            console.log(`[Chat Stream][${requestId}] Extracted Lead Info: ${contactInfo}`);
            
            try {
               await sendConsolidatedLeadEmail({
                tenantId,
                chatbotId,
                conversationId,
                newContactInfo: contactInfo,
                channelType: 'chat',
                customerName: clientName,
              });
            } catch (err: unknown) {
              console.error(`[Chat Stream][${requestId}] Background lead notification failed:`, err);
            }
          }

          if (userInsertRes.error) console.error(`[Chat Stream][${requestId}] Failed to log user message:`, userInsertRes.error);
          if (assistantInsertRes.error) console.error(`[Chat Stream][${requestId}] Failed to log assistant response:`, assistantInsertRes.error);
        } catch (dbErr: unknown) {
          console.error(`[Chat Stream][${requestId}] Background DB logging failed:`, dbErr);
        }
      },
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let hasText = false;
          let rawText = '';
          for await (const chunk of result.textStream) {
            hasText = true;
            rawText += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
          if (!hasText) {
            controller.enqueue(encoder.encode(`I'm sorry, I am having trouble connecting to my database. Please try again. [DEBUG: ${lastApiError || "Empty stream, no error caught."}]`));
            return;
          }

          // --- AVAILABILITY TOOL PASS ---
          const availMatch = rawText.match(/\[CHECK_AVAILABILITY:\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?)\]/);
          if (availMatch) {
            const staffId = availMatch[1].trim().replace(/['"]/g, '');
            const serviceId = availMatch[2].trim().replace(/['"]/g, '');
            const startStr = availMatch[3].trim().replace(/['"]/g, '');
            const endStr = availMatch[4].trim().replace(/['"]/g, '');
            
            const toolResult = await checkAvailability(tenantId, staffId, serviceId, startStr, endStr, timezone);
            
            const pass2Messages = [
              ...formattedMessages,
              { role: 'assistant', content: rawText },
              { role: 'user', content: `[SYSTEM] Availability Result:\n${toolResult}\nNow present the times to the user naturally. Do not use tags.` }
            ];
            
            const result2 = await streamText({
              model: google('gemini-3.5-flash'),
              system: systemPrompt,
              messages: pass2Messages,
              onFinish: async (event2) => {
                await supabaseAdmin.from('messages').insert({
                  tenant_id: tenantId,
                  conversation_id: conversationId,
                  sender_type: 'bot',
                  text_content: event2.text,
                });
              }
            });
            
            for await (const chunk of result2.textStream) {
              controller.enqueue(encoder.encode(chunk));
            }
          }

          // --- BOOKING TOOL PASS ---
          const bookMatch = rawText.match(/\[BOOK_MEETING:\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?)\]/);
          if (bookMatch) {
            const staffId = bookMatch[1].trim().replace(/['"]/g, '');
            const serviceId = bookMatch[2].trim().replace(/['"]/g, '');
            const custName = bookMatch[3].trim().replace(/['"]/g, '');
            const custEmail = bookMatch[4].trim().replace(/['"]/g, '');
            const custPhone = bookMatch[5].trim().replace(/['"]/g, '');
            const startStr = bookMatch[6].trim().replace(/['"]/g, '');
            const endStr = bookMatch[7].trim().replace(/['"]/g, '');
            
            const toolResult = await bookMeeting(tenantId, staffId, serviceId, custName, custEmail, custPhone, startStr, endStr, timezone);
            console.log(`[Chat Stream][${requestId}] Booking Result:`, toolResult);
            
            if (toolResult && toolResult.includes('Error:')) {
              const pass2Messages = [
                ...formattedMessages,
                { role: 'assistant', content: rawText },
                { role: 'user', content: `[SYSTEM] Booking Result:\n${toolResult}\nThe time slot was snatched by someone else! Apologize to the user naturally and ask them if they would like to pick a different time.` }
              ];
              
              const result2 = await streamText({
                model: google('gemini-3.5-flash'),
                system: `You are an AI assistant representing the business "${configData.businessName || 'our business'}".
Your goal is to answer questions strictly using the provided context and handle booking inquiries according to the business's booking mode.
If the answer isn't in the context, clearly state that you don't know and offer a fallback (like taking an email). Do not invent pricing, policies, or facts.

Booking Mode Information:
Current Booking Mode: ${bookingMode}
${bookingMode === 'walk_in_only' ? '- We DO NOT accept appointments. We are walk-ins only. If the user asks to book, politely inform them that they can just walk in at any time during our opening hours.' : ''}
${bookingMode === 'external_platform' ? `- We use an external booking platform. If the user asks to book, politely redirect them to our booking page: ${bookingUrl}` : ''}
${(bookingMode === 'single_calendar' || bookingMode === 'multi_calendar') ? '- We accept online bookings via the chat. Use your tools to check availability and book meetings.' : ''}

Available Services and Staff Context:
Services:
${servicesContext}
Staff:
${staffContext}

${(bookingMode === 'single_calendar' || bookingMode === 'multi_calendar') ? `
Available Booking Tools (Only invoke if explicitly booking an appointment):
- checkAvailability: Checks free slots for a specific date/staff/service.
- lookupAppointments: Finds an existing appointment by email/phone.
- bookMeeting: Confirms and locks in an appointment.
IMPORTANT: You cannot update or delete existing appointments. Instruct the user to contact the business directly to make changes.
` : `IMPORTANT: Do not attempt to use booking tools as the booking mode does not support internal calendar tools.`}

Business Context & FAQ:
${contextText}

Current time/date: ${new Date().toLocaleString('en-US', { timeZone: timezone })}
Currency: ${currency}
User identity context: ${clientName ? 'Client Name: ' + clientName : 'Anonymous'}
`,
                messages: pass2Messages as Parameters<typeof streamText>[0]['messages'],
                tools: (bookingMode === 'single_calendar' || bookingMode === 'multi_calendar') ? {
                  checkAvailability: tool({
                    description: 'Check available times for a specific date, service, and staff member.',
                    parameters: z.object({
                      startDateStr: z.string().describe('The start date to check in ISO format.'),
                      endDateStr: z.string().describe('The end date to check in ISO format.'),
                      serviceId: z.string().describe('The UUID of the requested service.'),
                      staffId: z.string().describe('The UUID of the requested staff member.'),
                    }),
                    execute: async ({ startDateStr, endDateStr, serviceId, staffId }: { startDateStr: string; endDateStr: string; serviceId: string; staffId: string }) => {
                      return await checkAvailability(tenantId, staffId, serviceId, startDateStr, endDateStr, timezone);
                    },
                  }),
                  lookupAppointments: tool({
                    description: 'Look up an existing appointment by the customer\'s email or phone number.',
                    parameters: z.object({
                      email: z.string().describe('The customer email to look up.'),
                      phone: z.string().describe('The customer phone number to look up.'),
                    }),
                    execute: async ({ email, phone }: { email?: string; phone?: string }) => {
                      return await lookupAppointments(tenantId, email || '', phone || '');
                    },
                  }),
                  bookMeeting: tool({
                    description: 'Book a meeting/appointment on the calendar.',
                    parameters: z.object({
                      customerName: z.string().describe('The customer\'s full name.'),
                      customerEmail: z.string().describe('The customer\'s email address.'),
                      customerPhone: z.string().describe('The customer\'s phone number.'),
                      startTimeIso: z.string().describe('The exact start time in ISO 8601 format.'),
                      endTimeIso: z.string().describe('The exact end time in ISO 8601 format.'),
                      serviceId: z.string().describe('The UUID of the booked service.'),
                      staffId: z.string().describe('The UUID of the assigned staff member.'),
                    }),
                    execute: async ({ customerName, customerEmail, customerPhone, startTimeIso, endTimeIso, serviceId, staffId }: { customerName: string; customerEmail: string; customerPhone: string; startTimeIso: string; endTimeIso: string; serviceId: string; staffId: string }) => {
                      return await bookMeeting(tenantId, staffId, serviceId, customerName, customerEmail, customerPhone, startTimeIso, endTimeIso, timezone);
                    },
                  }),
                } : ({} as Record<string, any>),
                onFinish: async (event2) => {
                  await supabaseAdmin.from('messages').insert({
                    tenant_id: tenantId,
                    conversation_id: conversationId,
                    sender_type: 'bot',
                    text_content: event2.text,
                  });
                }
              });
              
              for await (const chunk of result2.textStream) {
                controller.enqueue(encoder.encode(chunk));
              }
            }
          }

          // --- LOOKUP APPOINTMENTS TOOL PASS ---
          const lookupMatch = rawText.match(/\[LOOKUP_APPOINTMENTS:\s*(.+?),\s*(.+?)\]/);
          if (lookupMatch) {
            const custEmail = lookupMatch[1].trim().replace(/['"]/g, '');
            const custPhone = lookupMatch[2].trim().replace(/['"]/g, '');
            
            const toolResult = await lookupAppointments(tenantId, custEmail, custPhone, timezone);
            
            const pass2Messages = [
              ...formattedMessages,
              { role: 'assistant', content: rawText },
              { role: 'user', content: `[SYSTEM] Lookup Result:\n${toolResult}\nNow present this information naturally to the user.` }
            ];
            
            const result2 = await streamText({
              model: google('gemini-1.5-flash'),
              system: systemPrompt,
              messages: pass2Messages as Parameters<typeof streamText>[0]['messages'],
              onFinish: async (event2) => {
                await supabaseAdmin.from('messages').insert({
                  tenant_id: tenantId,
                  conversation_id: conversationId,
                  sender_type: 'bot',
                  text_content: event2.text,
                });
              }
            });
            
            for await (const chunk of result2.textStream) {
              controller.enqueue(encoder.encode(chunk));
            }
          }
        } catch (err: unknown) {
          console.error(`[Chat Stream][${requestId}] In-stream generation error:`, err);
          const errorMessage = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(`\n[STREAM ERROR: ${errorMessage}]`));
        } finally {
          controller.close();
        }
      }
    });


    return new Response(stream, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/plain; charset=utf-8',
      },
    });

  } catch (err: unknown) {
    console.error(`[Chat Stream][${requestId}] Unexpected route failure:`, err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Unexpected failure: ${errorMessage}` },
      { status: 200, headers: corsHeaders }
    );
  }
}

