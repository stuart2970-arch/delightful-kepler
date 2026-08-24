import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { streamText, generateText } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { checkAvailability, bookMeeting } from '@/app/api/chat/stream/calendar';

export const maxDuration = 300;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Vapi-Secret',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    let chatbotId = url.searchParams.get('chatbotId');
    if (chatbotId?.endsWith('/chat/completions')) {
      chatbotId = chatbotId.replace('/chat/completions', '');
    }

    if (!chatbotId) {
      return NextResponse.json({ error: 'Missing chatbotId in query' }, { status: 400, headers: corsHeaders });
    }

    const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY || '';
    const googleProvider = createGoogleGenerativeAI({ apiKey });

    const body = await req.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid messages payload' }, { status: 400, headers: corsHeaders });
    }

    const sessionId = body.call?.id || body.sessionId || req.headers.get('x-vapi-call-id') || req.headers.get('x-session-id') || `voice_${chatbotId.substring(0, 8)}_${Date.now()}`;

    // 1. Initialize Supabase Admin
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase admin environment variables are missing');
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    // 2. Fetch Chatbot & Tenant Details
    const { data: chatbot } = await supabaseAdmin
      .from('chatbots')
      .select('tenant_id, configuration_json')
      .eq('id', chatbotId)
      .single();

    if (!chatbot) {
      return NextResponse.json({ error: 'Chatbot not found' }, { status: 404, headers: corsHeaders });
    }

    const tenantId = chatbot.tenant_id;
    const configData = (chatbot.configuration_json || {}) as Record<string, any>;

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

    // 3. Extract latest user message for RAG
    const latestUserMessage = messages.slice().reverse().find((m: any) => m.role === 'user');
    let ragContext = '';
    let queryText = '';

    if (latestUserMessage && typeof latestUserMessage.content === 'string') {
      queryText = latestUserMessage.content;
      try {
        const embeddingRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'models/text-embedding-004',
            content: { parts: [{ text: queryText }] }
          })
        });

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
            ragContext = matchedChunks.map((chunk: any) => chunk.content).join('\n\n');
          }
        }
      } catch (e) {
        console.error('[Vapi Custom LLM] RAG embedding/match error:', e);
      }
    }

    // 4. Construct System Persona Prompt
    const schedulingRules = (bookingMode === 'single_calendar' || bookingMode === 'multi_calendar') ? `
CRITICAL SCHEDULING RULES FOR VOICE CALLS:
- RULE 1: First identify the Service and Staff member the caller wants. Consult the SERVICES and STAFF JSON configs for exact UUIDs and durations.
- RULE 2: Once you know the Staff ID and Service ID, you MUST check availability before offering or confirming any time slot. Reply politely (e.g. "Let me check availability for that day for you"), and append EXACTLY: [CHECK_AVAILABILITY: StaffID, ServiceID, StartDate, EndDate]. StartDate and EndDate should be ISO strings WITH the ${timezone} offset (e.g. +01:00).
- RULE 3: Once an available slot is confirmed by checking availability, you MUST ask the caller for BOTH their email address AND their mobile phone number before confirming the booking. You are STRICTLY FORBIDDEN from confirming a booking without both email and phone number.
- RULE 4: Once you have BOTH their email and mobile phone number, execute the booking by outputting EXACTLY: [BOOK_MEETING: StaffID, ServiceID, CustomerName, CustomerEmail, CustomerPhone, StartTime, EndTime].
- RULE 5: Use exact UUID strings for StaffID and ServiceID from the JSON configurations.
` : '';

    const systemPromptHeader = `You are a friendly, conversational AI phone representative speaking on behalf of "${businessName}".
Write in a natural, warm, spoken conversational tone. Speak clearly and concisely.
DO NOT use markdown formatting, asterisks, bullet points, or special characters. Speak naturally in plain text.

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
      let contentStr = typeof msg.content === 'string' ? msg.content : '';
      if (msg.role === 'system') {
        return {
          role: 'system',
          content: `${contentStr}\n\n${systemPromptHeader}`
        };
      }
      return msg;
    });

    if (!enhancedMessages.some((m: any) => m.role === 'system')) {
      enhancedMessages.unshift({ role: 'system', content: systemPromptHeader });
    }

    // 5. Generate LLM Pass 1
    const { text: rawText } = await generateText({
      model: googleProvider('gemini-3.5-flash'),
      messages: enhancedMessages,
      temperature: 0.7,
    });

    let finalSpokenText = rawText;

    // 6. Handle Tool Execution Interceptors (Check Availability / Book Meeting)
    const availMatch = rawText.match(/\[CHECK_AVAILABILITY:\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?)\]/);
    if (availMatch) {
      const staffId = availMatch[1].trim().replace(/['"]/g, '');
      const serviceId = availMatch[2].trim().replace(/['"]/g, '');
      const startStr = availMatch[3].trim().replace(/['"]/g, '');
      const endStr = availMatch[4].trim().replace(/['"]/g, '');

      console.log(`[Vapi Custom LLM Legacy] Executing checkAvailability for staff ${staffId}, service ${serviceId}`);
      const availResult = await checkAvailability(tenantId, staffId, serviceId, startStr, endStr, timezone);
      
      const { text: pass2Text } = await generateText({
        model: googleProvider('gemini-3.5-flash'),
        messages: [
          ...enhancedMessages,
          { role: 'assistant', content: rawText },
          { role: 'user', content: `[SYSTEM AVAILABILITY RESULT]:\n${availResult}\nSpeak the result naturally to the caller in plain conversational English without markdown or bracket tags.` }
        ],
        temperature: 0.7,
      });
      finalSpokenText = pass2Text;
    }

    const bookMatch = rawText.match(/\[BOOK_MEETING:\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?)\]/);
    if (bookMatch) {
      const staffId = bookMatch[1].trim().replace(/['"]/g, '');
      const serviceId = bookMatch[2].trim().replace(/['"]/g, '');
      const custName = bookMatch[3].trim().replace(/['"]/g, '');
      const custEmail = bookMatch[4].trim().replace(/['"]/g, '');
      const custPhone = bookMatch[5].trim().replace(/['"]/g, '');
      const startStr = bookMatch[6].trim().replace(/['"]/g, '');
      const endStr = bookMatch[7].trim().replace(/['"]/g, '');

      console.log(`[Vapi Custom LLM Legacy] Executing bookMeeting for ${custName} (${custEmail}, ${custPhone})`);
      const bookResult = await bookMeeting(tenantId, staffId, serviceId, custName, custEmail, custPhone, startStr, endStr, timezone);

      const { text: pass2Text } = await generateText({
        model: googleProvider('gemini-3.5-flash'),
        messages: [
          ...enhancedMessages,
          { role: 'assistant', content: rawText },
          { role: 'user', content: `[SYSTEM BOOKING RESULT]:\n${bookResult}\nInform the caller naturally of the result in plain conversational English without markdown or bracket tags.` }
        ],
        temperature: 0.7,
      });
      finalSpokenText = pass2Text;
    }

    // Clean any remaining bracket tags from spoken text
    finalSpokenText = finalSpokenText.replace(/\[(CHECK_AVAILABILITY|BOOK_MEETING|TIME_SLOTS|LEAD_CAPTURED|LOOKUP_APPOINTMENTS):?[^\]]*\]/gi, '').trim();

    // 7. Stream back to Vapi
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const roleChunk = {
            id: 'chatcmpl-vapi',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'gemini-3.5-flash',
            choices: [{ delta: { role: 'assistant', content: finalSpokenText }, index: 0, finish_reason: null }]
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(roleChunk)}\n\n`));

          const finishChunk = {
            id: 'chatcmpl-vapi',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'gemini-3.5-flash',
            choices: [{ delta: {}, index: 0, finish_reason: 'stop' }]
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
          controller.encode ? controller.enqueue(encoder.encode(`data: [DONE]\n\n`)) : null;
          controller.close();

          // Log session
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
              if (finalSpokenText) {
                await supabaseAdmin.from('messages').insert({
                  tenant_id: tenantId,
                  conversation_id: conv.id,
                  sender_type: 'bot',
                  text_content: finalSpokenText,
                  created_at: new Date(now).toISOString()
                });
              }
            }
          } catch (dbErr) {
            console.error('[Vapi Custom LLM Legacy] DB logging error:', dbErr);
          }
        } catch (err) {
          console.error('[Vapi Custom LLM Legacy] Stream error:', err);
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
    console.error('[Vapi Custom LLM Legacy] Unexpected failure:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}
