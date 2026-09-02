import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { streamText, generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { checkAvailability, bookMeeting } from '@/app/api/chat/stream/calendar';

import { getActiveGeminiModel } from '@/lib/gemini-config';

export const maxDuration = 300;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Vapi-Secret',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ chatbotId: string }> }
) {
  try {
    const resolvedParams = await params;
    let chatbotId = resolvedParams.chatbotId;

    if (!chatbotId) {
      return NextResponse.json({ error: 'Missing chatbotId in path' }, { status: 400, headers: corsHeaders });
    }

    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      throw new Error('GOOGLE_GENERATIVE_AI_API_KEY / GEMINI_API_KEY environment variable is missing');
    }
    const googleProvider = createGoogleGenerativeAI({ apiKey });

    const body = await req.json();
    const { messages } = body; // standard OpenAI messages array payload from Vapi

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid messages payload' }, { status: 400, headers: corsHeaders });
    }

    // Resolve session ID for logging
    const sessionId = body.call?.id || body.sessionId || req.headers.get('x-vapi-call-id') || req.headers.get('x-session-id') || `voice_${chatbotId.substring(0, 8)}_${Date.now()}`;

    // 1. Initialize Supabase Admin with environment variables
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase admin environment variables are missing');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    let tenantId = '00000000-0000-0000-0000-000000000000';
    let configData: Record<string, any> = {};

    // Feature-flag to disable onboarding FloBot
    const disableOnboarding = process.env.DISABLE_ONBOARDING_BOT === 'true';
    if (disableOnboarding && chatbotId === 'styleflo-onboarding-flobot') {
      return NextResponse.json({ error: 'Onboarding bot is disabled.' }, { status: 404, headers: corsHeaders });
    }

    if (chatbotId === 'styleflo-onboarding-flobot') {
      const { data: globalBot } = await supabaseAdmin
        .from('chatbots')
        .select('configuration_json')
        .eq('id', '00000000-0000-0000-0000-000000000000')
        .maybeSingle();
      if (globalBot?.configuration_json?.flobot_config) {
        configData = globalBot.configuration_json.flobot_config;
      }
    } else {
      const { data: chatbot } = await supabaseAdmin
        .from('chatbots')
        .select('tenant_id, configuration_json')
        .eq('id', chatbotId)
        .single();

      if (!chatbot) {
        return NextResponse.json({ error: 'Chatbot not found' }, { status: 404, headers: corsHeaders });
      }

      tenantId = chatbot.tenant_id;
      configData = (chatbot.configuration_json || {}) as Record<string, any>;
    }

    const { data: tenantRes } = await supabaseAdmin
      .from('tenants')
      .select('id, name, booking_mode, booking_url, currency, timezone')
      .eq('id', tenantId)
      .single();

    const bookingMode = tenantRes?.booking_mode || 'single_calendar';
    const bookingUrl = tenantRes?.booking_url || '';
    const timezone = tenantRes?.timezone || 'Europe/London';
    const currency = tenantRes?.currency || '£';
    const businessName = configData.businessName || tenantRes?.name || 'our business';

    const { data: servicesRes } = await supabaseAdmin
      .from('services')
      .select('id, name, base_price, duration_minutes, buffer_minutes, description')
      .eq('tenant_id', tenantId)
      .eq('chatbot_id', chatbotId);

    const { data: staffRes } = await supabaseAdmin
      .from('staff')
      .select('id, name, role, google_calendar_id, working_days, staff_services(service_id, custom_price, custom_duration)')
      .eq('tenant_id', tenantId)
      .eq('chatbot_id', chatbotId);

    const servicesContext = servicesRes ? JSON.stringify(servicesRes, null, 2) : '[]';
    const staffContext = staffRes ? JSON.stringify(staffRes, null, 2) : '[]';

    let globalDisclaimer = '';
    const { data: globalBot } = await supabaseAdmin
      .from('chatbots')
      .select('configuration_json')
      .eq('id', '00000000-0000-0000-0000-000000000000')
      .single();
    
    if (globalBot?.configuration_json) {
      globalDisclaimer = (globalBot.configuration_json as any).global_voice_disclaimer || '';
    }

    // 3. Extract the latest user message for RAG embedding
    const latestUserMessage = messages.slice().reverse().find((m: any) => m.role === 'user');
    let ragContext = '';
    let queryText = '';

    if (latestUserMessage) {
      if (typeof latestUserMessage.content === 'string') {
        queryText = latestUserMessage.content;
      } else if (Array.isArray(latestUserMessage.content)) {
        queryText = latestUserMessage.content
          .map((part: any) => (typeof part === 'string' ? part : part?.text || ''))
          .join(' ');
      }
    }

    const lowerQuery = queryText.toLowerCase();
    const isEchoedGreeting = 
      lowerQuery.includes("you're through to") || 
      lowerQuery.includes("you are through to") || 
      lowerQuery.includes("flowchat") || 
      lowerQuery.includes("flochat") || 
      lowerQuery.includes("can i help you today") || 
      lowerQuery.includes("how can i help you today");

    if (isEchoedGreeting) {
      console.log('[Vapi Custom LLM] Ignoring echoed assistant greeting turn:', queryText);
      const isStream = body.stream !== false;
      if (!isStream) {
        return NextResponse.json({
          id: 'chatcmpl-vapi',
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: 'gemini-2.5-flash',
          choices: [{ message: { role: 'assistant', content: '' }, finish_reason: 'stop', index: 0 }]
        }, { headers: corsHeaders });
      }

      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        async start(controller) {
          const roleChunk = {
            id: 'chatcmpl-vapi',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'gemini-2.5-flash',
            choices: [{ delta: { role: 'assistant', content: '' }, index: 0, finish_reason: null }]
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(roleChunk)}\n\n`));
          const finishChunk = {
            id: 'chatcmpl-vapi',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'gemini-2.5-flash',
            choices: [{ delta: {}, index: 0, finish_reason: 'stop' }]
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        }
      });
      return new Response(stream, {
        headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', ...corsHeaders }
      });
    }

    if (queryText && apiKey) {
      try {
        const fetchEmbed = async () => {
          const embeddingRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'models/text-embedding-004',
              content: { parts: [{ text: queryText }] }
            })
          });

          if (embeddingRes.ok) {
            const embedData = await embeddingRes.json();
            const embedding = embedData.embedding?.values;

            if (embedding) {
              const { data: matchedChunks, error: matchError } = await supabaseAdmin.rpc('match_documents', {
                query_embedding: embedding,
                match_threshold: 0.2,
                match_count: 5,
                targeting_tenant_id: tenantId,
                targeting_chatbot_id: chatbotId
              });

              if (!matchError && matchedChunks && matchedChunks.length > 0) {
                return matchedChunks.map((chunk: any) => chunk.content).join('\n\n');
              }
            }
          }
          return '';
        };

        // Race RAG embedding fetch with a 1.2s timeout so voice streams never delay
        ragContext = await Promise.race([
          fetchEmbed(),
          new Promise<string>((resolve) => setTimeout(() => resolve(''), 1200))
        ]);
      } catch (e) {
        console.error('[Vapi Custom LLM] RAG embedding/match error:', e);
      }
    }

    // 4. Construct System Persona Prompt
    const schedulingRules = (bookingMode === 'single_calendar' || bookingMode === 'multi_calendar') ? `
CRITICAL SCHEDULING RULES FOR VOICE CALLS:
- RULE 1 (STAFF SELECTION): Identify the Service and any requested Staff member. If NO staff member is specified by the caller, pass 'ANY' as StaffID to check availability across ALL qualified staff members.
- RULE 1b (ALTERNATIVE STAFF OFFER): If the requested staff member (e.g. Jane) is UNAVAILABLE at the requested time slot (e.g. 10:00 AM), but ANOTHER qualified staff member (e.g. Stuart) IS available at 10:00 AM, DO NOT say 10:00 AM is unavailable! Instead, politely offer the 10:00 AM slot with the available colleague (e.g., "Jane is booked at 10:00 AM, but Stuart is available at 10:00 AM! Would you like to book with Stuart, or choose a different time with Jane?").
- RULE 1c (FUZZY SERVICE PATTERN MATCHING): Callers will often state service requests using informal or varied phrasing (e.g., "assisted build", "build help", "setup assistance", "30 min chat"). You MUST search and match similar text patterns across all names and descriptions in SERVICES CONFIGURATION. Match to the most relevant service (e.g., "assisted build" -> "Assisted Setup"). Never default to an unrelated service!
- RULE 1d (SERVICE & STAFF CONFIRMATION): Always state the exact service name, duration, and staff pricing options to the caller to confirm their choice before checking availability or finalizing a booking. For example: "Just to confirm, you would like to book an Assisted Setup session? We have Jane available for 60 minutes, or Stuart for £75 for a quicker 45-minute session. Which would you prefer?"
- RULE 2: Once you know the Staff ID (or 'ANY') and Service ID, you MUST check availability before offering or confirming any slot. Reply politely (e.g. "Let me check availability for that day for you"), and append EXACTLY: [CHECK_AVAILABILITY: StaffID, ServiceID, StartDate, EndDate]. StartDate and EndDate should be ISO strings WITH the ${timezone} offset (e.g. +01:00).
- RULE 3: Once an available slot is confirmed by checking availability, you MUST ask the caller for BOTH their email address AND their mobile phone number before confirming the booking. You are STRICTLY FORBIDDEN from confirming a booking without both email and phone number.
- RULE 4: Once you have BOTH their email and mobile phone number, execute the booking by outputting EXACTLY: [BOOK_MEETING: StaffID, ServiceID, CustomerName, CustomerEmail, CustomerPhone, StartTime, EndTime].
- RULE 4b (SUCCESSFUL BOOKING LOCK): Once a booking has been executed by [BOOK_MEETING], the appointment is LOCKED AND CONFIRMED. You are STRICTLY FORBIDDEN from running [CHECK_AVAILABILITY] again for the same booking turn, or claiming the slot was taken by someone else.
- RULE 5: Use exact UUID strings for StaffID and ServiceID from JSON configs (or 'ANY' for StaffID).
` : '';

    // Extract Chatbot Rules
    const rawRules = configData.chatbot_rules;
    let chatbotRules: string[] = [];
    if (Array.isArray(rawRules)) {
      chatbotRules = rawRules.map((r: any) => String(r).trim()).filter(Boolean);
    } else if (typeof rawRules === 'string') {
      chatbotRules = rawRules.split('\n').map((r: string) => r.trim()).filter(Boolean);
    }

    const voiceRulesSection = chatbotRules.length > 0
      ? `\n\nMANDATORY BUSINESS RULES:\nYou MUST strictly adhere to and enforce all of the following rules set by the business in your spoken response:\n${chatbotRules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`
      : '';

    // Analyze FloBot state memory from transcript
    const fullVoiceText = messages.map((m: any) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
    const vEmailMatch = fullVoiceText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const vDetectedEmail = vEmailMatch ? vEmailMatch[0] : null;

    const vCodeMatch = fullVoiceText.match(/FLO-\d{4}/i);
    const vDetectedCode = vCodeMatch ? vCodeMatch[0].toUpperCase() : null;

    const vHasIdentity = /liverpool|halewood|manchester|london|miles|city|radius|dogs|salon|barber|clinic|studio/i.test(fullVoiceText) && (vDetectedEmail !== null || fullVoiceText.toLowerCase().includes('email'));

    let currentFloVoiceStep = 'STEP 1 (ENROLLMENT)';
    if (vDetectedEmail && vHasIdentity) {
      currentFloVoiceStep = 'STEP 3 (INGESTION)';
    } else if (vDetectedEmail) {
      currentFloVoiceStep = 'STEP 2 (IDENTITY)';
    }

    const systemPromptHeader = chatbotId === 'styleflo-onboarding-flobot'
      ? `You are Flo, the official AI registration assistant for StyleFlo.
Write in a natural, warm, spoken conversational tone. Speak clearly and concisely. DO NOT use markdown formatting, asterisks, or special characters.

CONVERSATION STATE MEMORY:
- CURRENT ACTIVE ONBOARDING STEP: ${currentFloVoiceStep}
${vDetectedEmail ? `- CONFIRMED USER EMAIL: ${vDetectedEmail} (DO NOT ASK FOR EMAIL OR SIGNUP METHOD AGAIN!)` : ''}
${vDetectedCode ? `- ASSIGNED RESUMPTION CODE: ${vDetectedCode} (DO NOT GENERATE A NEW RESUMPTION CODE!)` : ''}
${vHasIdentity ? `- LOCATION & IDENTITY CONFIRMED (DO NOT ask for location or business name again!)` : ''}

CURRENT STEP TASK INSTRUCTIONS:
${currentFloVoiceStep === 'STEP 1 (ENROLLMENT)' ? 'Ask whether they prefer to sign up with Google or Email.' : ''}
${currentFloVoiceStep === 'STEP 2 (IDENTITY)' ? 'Location confirmed! Acknowledge their location (e.g. Halewood, Liverpool) and ask for their website URL/sitemap or price list upload! DO NOT ask for email or signup method.' : ''}
${currentFloVoiceStep === 'STEP 3 (INGESTION)' ? 'Knowledge base ingestion confirmed! Ask which booking operational mode fits best.' : ''}

CRITICAL SPOKEN LAWS:
1. NEVER REPEAT GREETINGS: Do not say "Welcome to StyleFlo!" or re-introduce yourself.
2. NO RE-ASKING FOR EMAIL: Email is ALREADY CONFIRMED (${vDetectedEmail || 'on file'}). You are STRICTLY FORBIDDEN from asking whether they want to sign up with Google or Email.
3. ZERO RE-PROMPTING ON QUESTIONS: If the caller asks a question like "how do i add my password", answer concisely in 1 sentence, and then IMMEDIATELY execute the CURRENT STEP TASK.
4. NO DUPLICATE CODES: Never generate a second resumption code.
5. LINEAR PROGRESSION: Advance smoothly through Step 1 ➔ Step 2 ➔ Step 3 ➔ Step 4 ➔ Step 5.`
      : `You are a friendly, conversational AI phone representative speaking on behalf of "${businessName}".
Write in a natural, warm, spoken conversational tone. Speak clearly and concisely.
DO NOT use markdown formatting, asterisks, bullet points, or special characters. Speak naturally in plain text.${voiceRulesSection}

The current date and time is: ${new Date().toISOString()}. Use this to resolve relative dates like "tomorrow" or "next Sunday".

${bookingMode === 'walk_in_only' ? 'We DO NOT accept appointments. We are walk-ins only. If the caller asks to book, politely inform them they can walk in at any time.' : ''}
${bookingMode === 'external_platform' ? `We use an external booking platform. If the caller asks to book, direct them to ${bookingUrl}` : ''}
${schedulingRules}

BUSINESS KNOWLEDGE:
${ragContext}

SERVICES CONFIGURATION (JSON):
${servicesContext}

STAFF CONFIGURATION (JSON):
${staffContext}

REGULATORY DISCLAIMER:
${globalDisclaimer}`;

    const enhancedMessages = messages.map((msg: any) => {
      let contentStr = '';
      if (typeof msg.content === 'string') {
        contentStr = msg.content;
      } else if (Array.isArray(msg.content)) {
        contentStr = msg.content.map((p: any) => (typeof p === 'string' ? p : p?.text || '')).join(' ');
      }

      if (msg.role === 'system') {
        return {
          role: 'system',
          content: `${contentStr}\n\n${systemPromptHeader}`
        };
      }
      return {
        role: msg.role,
        content: contentStr
      };
    });

    // Ensure system prompt is present if missing from messages payload
    if (!enhancedMessages.some((m: any) => m.role === 'system')) {
      enhancedMessages.unshift({ role: 'system', content: systemPromptHeader });
    }

    const activeModelName = await getActiveGeminiModel();

    // 5. High-Speed Streaming Response (< 400ms TTFT to prevent Vapi timeout)
    const isStream = body.stream !== false;

    if (!isStream) {
      const { text: rawText } = await generateText({
        model: googleProvider(activeModelName),
        messages: enhancedMessages,
        temperature: 0.7,
      });

      return NextResponse.json({
        id: 'chatcmpl-vapi',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: activeModelName,
        choices: [
          {
            message: { role: 'assistant', content: rawText },
            finish_reason: 'stop',
            index: 0
          }
        ]
      }, { headers: corsHeaders });
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send initial role chunk immediately so Vapi receives TTFT < 100ms
          const startRoleChunk = {
            id: 'chatcmpl-vapi',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: activeModelName,
            choices: [{ delta: { role: 'assistant' }, index: 0, finish_reason: null }]
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(startRoleChunk)}\n\n`));

          const result = streamText({
            model: googleProvider(activeModelName),
            messages: enhancedMessages,
            temperature: 0.7,
          });

          let fullText = '';
          let pendingChunks: string[] = [];
          let containsBracketTag = false;

          for await (const textDelta of result.textStream) {
            fullText += textDelta;

            if (fullText.includes('[') || containsBracketTag) {
              containsBracketTag = true;
              pendingChunks.push(textDelta);
            } else {
              // Safe normal speech — stream chunk immediately to Vapi
              const deltaChunk = {
                id: 'chatcmpl-vapi',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: activeModelName,
                choices: [{ delta: { content: textDelta }, index: 0, finish_reason: null }]
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(deltaChunk)}\n\n`));
            }
          }

          // Check if calendar tool interceptor was triggered
          const availMatch = fullText.match(/\[CHECK_AVAILABILITY:\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?)\]/);
          const bookMatch = fullText.match(/\[BOOK_MEETING:\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?)\]/);

          if (availMatch || bookMatch) {
            // Stream immediate vocal filler phrase so caller hears zero dead silence while Google Calendar runs
            const fillerPhrase = availMatch 
              ? 'Let me check availability for that slot for you right now... '
              : 'Thank you! Processing your booking confirmation now... ';

            const fillerChunk = {
              id: 'chatcmpl-vapi',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: activeModelName,
              choices: [{ delta: { content: fillerPhrase }, index: 0, finish_reason: null }]
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(fillerChunk)}\n\n`));

            let toolResult = '';
            if (availMatch) {
              const staffId = availMatch[1].trim().replace(/['"]/g, '');
              const serviceId = availMatch[2].trim().replace(/['"]/g, '');
              const startStr = availMatch[3].trim().replace(/['"]/g, '');
              const endStr = availMatch[4].trim().replace(/['"]/g, '');
              toolResult = await checkAvailability(tenantId, staffId, serviceId, startStr, endStr, timezone);
            } else if (bookMatch) {
              const staffId = bookMatch[1].trim().replace(/['"]/g, '');
              const serviceId = bookMatch[2].trim().replace(/['"]/g, '');
              const custName = bookMatch[3].trim().replace(/['"]/g, '');
              const custEmail = bookMatch[4].trim().replace(/['"]/g, '');
              const custPhone = bookMatch[5].trim().replace(/['"]/g, '');
              const startStr = bookMatch[6].trim().replace(/['"]/g, '');
              const endStr = bookMatch[7].trim().replace(/['"]/g, '');
              toolResult = await bookMeeting(tenantId, staffId, serviceId, custName, custEmail, custPhone, startStr, endStr, timezone);
            }

            const isBookingSuccess = bookMatch && (toolResult.toLowerCase().includes('confirmed') || toolResult.toLowerCase().includes('success'));
            const pass2Prompt = isBookingSuccess
              ? `[SYSTEM BOOKING SUCCESS RESULT]:\n${toolResult}\nCRITICAL INSTRUCTION: The booking WAS EXECUTED SUCCESSFULLY and IS CONFIRMED. DO NOT check availability again. DO NOT say the slot was taken or unavailable. Enthusiastically and politely confirm to the customer that their appointment is booked!`
              : `[SYSTEM RESULT]:\n${toolResult}\nSpeak the result naturally to the caller in plain conversational English without markdown, codes, or bracket tags.`;

            const preBracketText = fullText.split('[')[0].trim();

            const pass2Result = streamText({
              model: googleProvider(activeModelName),
              messages: [
                ...enhancedMessages,
                { role: 'assistant', content: preBracketText || fillerPhrase },
                { role: 'user', content: pass2Prompt }
              ],
              temperature: 0.7,
            });

            for await (const textDelta of pass2Result.textStream) {
              const cleanDelta = textDelta.replace(/\[(CHECK_AVAILABILITY|BOOK_MEETING|TIME_SLOTS|LEAD_CAPTURED|LOOKUP_APPOINTMENTS):?[^\]]*\]/gi, '');
              if (cleanDelta) {
                const deltaChunk = {
                  id: 'chatcmpl-vapi',
                  object: 'chat.completion.chunk',
                  created: Math.floor(Date.now() / 1000),
                  model: activeModelName,
                  choices: [{ delta: { content: cleanDelta }, index: 0, finish_reason: null }]
                };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(deltaChunk)}\n\n`));
              }
            }
          } else if (containsBracketTag && pendingChunks.length > 0) {
            // Bracket was not a tool tag — flush pending chunks safely
            const remainingCleanText = pendingChunks.join('');
            const deltaChunk = {
              id: 'chatcmpl-vapi',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: activeModelName,
              choices: [{ delta: { content: remainingCleanText }, index: 0, finish_reason: null }]
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(deltaChunk)}\n\n`));
          }

          const finishChunk = {
            id: 'chatcmpl-vapi',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: activeModelName,
            choices: [{ delta: {}, index: 0, finish_reason: 'stop' }]
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();

          // Save voice session and speech messages to Supabase after stream finishes
          try {
            let { data: conv } = await supabaseAdmin
              .from('conversations')
              .select('id')
              .eq('tenant_id', tenantId)
              .eq('user_session_id', sessionId)
              .maybeSingle();

            if (!conv) {
              const { data: newConv } = await supabaseAdmin
                .from('conversations')
                .insert({
                  tenant_id: tenantId,
                  chatbot_id: chatbotId,
                  user_session_id: sessionId,
                  is_voice_call: true
                })
                .select('id')
                .single();
              conv = newConv;
            }

            if (conv?.id) {
              const cleanSpoken = fullText.replace(/\[(CHECK_AVAILABILITY|BOOK_MEETING|TIME_SLOTS|LEAD_CAPTURED|LOOKUP_APPOINTMENTS):?[^\]]*\]/gi, '').trim();
              const now = Date.now();
              if (queryText) {
                await supabaseAdmin.from('messages').insert({
                  tenant_id: tenantId,
                  conversation_id: conv.id,
                  sender_type: 'user',
                  text_content: queryText,
                  created_at: new Date(now - 1000).toISOString()
                });
              }
              if (cleanSpoken) {
                await supabaseAdmin.from('messages').insert({
                  tenant_id: tenantId,
                  conversation_id: conv.id,
                  sender_type: 'bot',
                  text_content: cleanSpoken,
                  created_at: new Date(now).toISOString()
                });
              }
            }
          } catch (dbErr) {
            console.error('[Vapi Custom LLM] Database voice logging error:', dbErr);
          }

        } catch (err) {
          console.error('[Vapi Custom LLM Stream Error]:', err);
          controller.error(err);
        }
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        ...corsHeaders
      }
    });

  } catch (error: any) {
    console.error('[Vapi Custom LLM] Unexpected failure:', error);
    return NextResponse.json({ error: 'Internal server error', details: error?.message || String(error) }, { status: 500, headers: corsHeaders });
  }
}
