import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { streamText, embed, tool } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import formData from 'form-data';
import Mailgun from 'mailgun.js';
import { checkAvailability, bookMeeting } from './calendar';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
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
  chatbotId: z.string().regex(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, { message: 'Invalid chatbot ID format' }),
  sessionId: z.string().min(1, { message: 'Session ID cannot be empty' }),
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

    const { message, chatbotId, sessionId } = validation.data;
    console.log(`[Chat Stream][${requestId}] Chatbot ID: ${chatbotId}, Session ID: ${sessionId}`);

    // 3. Resolve tenant_id from chatbotId (CRITICAL to prevent cross-tenant queries)
    const { data: chatbot, error: chatbotError } = await supabaseAdmin
      .from('chatbots')
      .select('tenant_id')
      .eq('id', chatbotId)
      .single();

    if (chatbotError || !chatbot) {
      console.warn(`[Chat Stream][${requestId}] Chatbot validation failed or not found:`, chatbotError);
      return NextResponse.json({ error: `Chatbot not found: ${chatbotError?.message}` }, { status: 200, headers: corsHeaders });
    }

    const tenantId = chatbot.tenant_id;
    console.log(`[Chat Stream][${requestId}] Resolved Tenant ID: ${tenantId}`);

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
    } catch (embeddingErr: any) {
      console.error(`[Chat Stream][${requestId}] Gemini embedding creation failed:`, embeddingErr);
      return NextResponse.json({ error: `Embedding failed: ${embeddingErr.message}` }, { status: 200, headers: corsHeaders });
    }

    // 5. Query matching documents using the match_documents RPC (strictly filtered by tenant_id & chatbot_id)
    console.log(`[Chat Stream][${requestId}] Searching similarity index...`);
    const { data: matchedDocuments, error: rpcError } = await supabaseAdmin.rpc('match_documents', {
      query_embedding: queryEmbedding,
      match_threshold: 0.2, // retrieve broader content if close, similarity score threshold
      match_count: 4, // pull top 4 context chunks
      targeting_tenant_id: tenantId,
      targeting_chatbot_id: chatbotId,
    });

    if (rpcError) {
      console.error(`[Chat Stream][${requestId}] match_documents RPC failed:`, rpcError);
      return NextResponse.json({ error: `Context retrieval failed: ${rpcError.message}` }, { status: 200, headers: corsHeaders });
    }

    const contextText = matchedDocuments && matchedDocuments.length > 0
      ? matchedDocuments.map((doc: any) => `- ${doc.content}`).join('\n\n')
      : 'No context available.';
    
    // Fetch Services and Staff for Calendar integration
    const [servicesRes, staffRes] = await Promise.all([
      supabaseAdmin.from('services').select('id, name, duration_minutes, buffer_minutes, price, staff_services(staff_id, custom_price, custom_duration)').eq('tenant_id', tenantId),
      supabaseAdmin.from('staff').select('id, name').eq('tenant_id', tenantId)
    ]);
    const servicesContext = servicesRes.data ? JSON.stringify(servicesRes.data, null, 2) : '[]';
    const staffContext = staffRes.data ? JSON.stringify(staffRes.data, null, 2) : '[]';

    console.log(`[Chat Stream][${requestId}] Retrieved ${matchedDocuments?.length || 0} context documents and calendar config.`);

    // 6. Get or create conversation record
    console.log(`[Chat Stream][${requestId}] Resolving conversation session...`);
    let conversationId: string;
    const { data: conversation, error: convError } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('chatbot_id', chatbotId)
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
          chatbot_id: chatbotId,
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

    // 7. Retrieve chat history (last 20 messages)
    const { data: recentHistory, error: historyError } = await supabaseAdmin
      .from('messages')
      .select('sender_type, text_content')
      .eq('conversation_id', conversationId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(20);

    const chatHistory = recentHistory ? recentHistory.reverse() : [];

    if (historyError) {
      console.error(`[Chat Stream][${requestId}] Failed to fetch history:`, historyError);
      // Fallback: we will proceed with an empty history rather than failing the chat
    }

    // 8. Build prompt and historical message messages array
    const systemPrompt = `You are a friendly, conversational AI customer support assistant representing this company.
Use ONLY the following context to answer the user's query. 
If you do not know the answer, politely ask them to drop their email or phone number so a human agent can follow up.

The current date and time is: ${new Date().toISOString()}. Use this to resolve relative dates like "tomorrow" or "next Sunday".

Guidelines:
- Write in a natural, warm, and human-like conversational tone.
- Use emojis occasionally to feel friendly.
- Use short paragraphs and avoid overwhelming the user with long blocks of text.
- If presenting multiple items, use clean bullet points.
- CRITICAL: If the user explicitly types their email or phone number in the chat, you MUST end your response with exactly: [LEAD_CAPTURED: their_email_or_phone]. DO NOT use this tag to ask them for their info. Only use it when they actually provide it!
- CRITICAL SCHEDULING RULE 1: If the user wants to book an appointment, first identify the Service and the Staff member they want. Consult the SERVICES CONFIGURATION JSON to accurately quote prices and durations based on any custom overrides the staff member might have for that service.
- CRITICAL SCHEDULING RULE 2: Once you know the Staff ID and Service ID, you MUST check their availability. Reply with a polite conversational message to the user (e.g., "Let me check that for you!"), and then append EXACTLY: [CHECK_AVAILABILITY: StaffID, ServiceID, StartDate, EndDate]. StartDate and EndDate should be ISO strings. 
- CRITICAL SCHEDULING RULE 3: Once you have checked availability and the user agrees to a specific available slot, you MUST book it by responding with a polite message, and then append EXACTLY: [BOOK_MEETING: StaffID, ServiceID, CustomerName, CustomerEmail, StartTime, EndTime]. StartTime and EndTime must be precise ISO strings.
- CRITICAL: You MUST use the exact UUID strings for StaffID and ServiceID from the JSON configurations. Do NOT use their names!
- When outputting a secret tag like [CHECK_AVAILABILITY...] or [BOOK_MEETING...], it MUST be the very last line of your response.

Context:
[INJECTED CHUNKS]
${contextText}

[SERVICES CONFIGURATION (JSON)]
${servicesContext}

[STAFF CONFIGURATION (JSON)]
${staffContext}`;

    const formattedMessages: any[] = [];
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
      model: google('gemini-3.5-flash'),
      system: systemPrompt,
      messages: formattedMessages,
      onError: (err: any) => {
        console.error(`[Chat Stream][${requestId}] API Stream Error:`, err);
        lastApiError = err?.error?.message || err?.error?.toString() || err?.toString() || "Unknown API Error";
      },
      onFinish: async (event) => {
        console.log(`[Chat Stream][${requestId}] AI stream finished. Logging conversation in background...`);
        try {
          const userMessageInsert = supabaseAdmin.from('messages').insert({
            tenant_id: tenantId,
            conversation_id: conversationId,
            sender_type: 'user',
            text_content: message,
          });

          const assistantMessageInsert = supabaseAdmin.from('messages').insert({
            tenant_id: tenantId,
            conversation_id: conversationId,
            sender_type: 'bot',
            text_content: event.text.replace(/\[LEAD_CAPTURED:.*?\]/g, '').replace(/\[CHECK_AVAILABILITY:.*?\]/g, '').replace(/\[BOOK_MEETING:.*?\]/g, '').trim(),
          });

          const [userInsertRes, assistantInsertRes] = await Promise.all([
            userMessageInsert,
            assistantMessageInsert,
          ]);

          // Handle manual lead capture
          const leadMatch = event.text.match(/\[LEAD_CAPTURED:\s*(.+?)\]/);
          if (leadMatch && leadMatch[1]) {
            const contactInfo = leadMatch[1];
            console.log(`[Chat Stream][${requestId}] Extracted Lead Info: ${contactInfo}`);
            
            // Fire Mailgun email silently in background
            try {
              const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('tenant_id', tenantId).eq('role', 'owner').limit(1).single();
              if (profile) {
                const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(profile.id);
                if (authUser?.user?.email && process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN) {
                  const mailgun = new Mailgun(formData);
                  const mg = mailgun.client({ username: 'api', key: process.env.MAILGUN_API_KEY });
                  await mg.messages.create(process.env.MAILGUN_DOMAIN, {
                    from: `StyleFlo Assistant <no-reply@${process.env.MAILGUN_DOMAIN}>`,
                    to: [authUser.user.email],
                    subject: 'New Lead Captured by AI Chatbot',
                    text: `You have a new lead from your Chatbot!\n\nContact Info: ${contactInfo}\n\nLog into your StyleFlo Dashboard to view the full conversation transcript.`,
                  });
                  console.log(`[Chat Stream][${requestId}] Successfully emailed lead to ${authUser.user.email}`);
                }
              }
            } catch (err: any) {
              console.error(`[Chat Stream][${requestId}] Background lead email failed:`, err);
            }
          }

          if (userInsertRes.error) console.error(`[Chat Stream][${requestId}] Failed to log user message:`, userInsertRes.error);
          if (assistantInsertRes.error) console.error(`[Chat Stream][${requestId}] Failed to log assistant response:`, assistantInsertRes.error);
        } catch (dbErr) {
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
            
            const toolResult = await checkAvailability(tenantId, staffId, serviceId, startStr, endStr);
            
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
          const bookMatch = rawText.match(/\[BOOK_MEETING:\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?),\s*(.+?)\]/);
          if (bookMatch) {
            const staffId = bookMatch[1].trim().replace(/['"]/g, '');
            const serviceId = bookMatch[2].trim().replace(/['"]/g, '');
            const custName = bookMatch[3].trim().replace(/['"]/g, '');
            const custEmail = bookMatch[4].trim().replace(/['"]/g, '');
            const startStr = bookMatch[5].trim().replace(/['"]/g, '');
            const endStr = bookMatch[6].trim().replace(/['"]/g, '');
            
            // Run asynchronously so we don't block closing the stream
            bookMeeting(tenantId, staffId, serviceId, custName, custEmail, startStr, endStr).then(res => {
                console.log(`[Chat Stream][${requestId}] Booking Background Result:`, res);
             }).catch(err => {
                console.error(`[Chat Stream][${requestId}] Booking Background Error:`, err);
             });
          }
        } catch (err: any) {
          console.error(`[Chat Stream][${requestId}] In-stream generation error:`, err);
          controller.enqueue(encoder.encode(`\n[STREAM ERROR: ${err.message}]`));
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

  } catch (err: any) {
    console.error(`[Chat Stream][${requestId}] Unexpected route failure:`, err);
    return NextResponse.json(
      { error: `Unexpected failure: ${err.message}` },
      { status: 200, headers: corsHeaders }
    );
  }
}
