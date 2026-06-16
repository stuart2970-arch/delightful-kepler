import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { streamText, embed } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';

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
    
    console.log(`[Chat Stream][${requestId}] Retrieved ${matchedDocuments?.length || 0} context documents.`);

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

    // 7. Retrieve chat history (last 10 messages)
    const { data: chatHistory, error: historyError } = await supabaseAdmin
      .from('messages')
      .select('sender_type, text_content')
      .eq('conversation_id', conversationId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true })
      .limit(10);

    if (historyError) {
      console.error(`[Chat Stream][${requestId}] Failed to fetch history:`, historyError);
      // Fallback: we will proceed with an empty history rather than failing the chat
    }

    // 8. Build prompt and historical message messages array
    const systemPrompt = `You are an expert AI customer support assistant representing this company. Use ONLY the following context to answer the user's query. If you do not know the answer, politely ask them to drop their email or phone number so a human agent can follow up. Context:\n[INJECTED CHUNKS]\n${contextText}`;

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

    console.log(`[Chat Stream][${requestId}] Initializing Vercel AI SDK text stream (gemini-1.5-flash)...`);

    // 9. Invoke streamText and setup async database transaction logging
    const result = await streamText({
      model: google('gemini-1.5-flash'),
      system: systemPrompt,
      messages: formattedMessages,
      onFinish: async (event) => {
        console.log(`[Chat Stream][${requestId}] AI stream finished. Logging conversation in background...`);
        try {
          // Concurrently insert user and assistant messages into the database
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
            text_content: event.text,
          });

          const [userInsertRes, assistantInsertRes] = await Promise.all([
            userMessageInsert,
            assistantMessageInsert,
          ]);

          if (userInsertRes.error) {
            console.error(`[Chat Stream][${requestId}] Failed to log user message:`, userInsertRes.error);
          }
          if (assistantInsertRes.error) {
            console.error(`[Chat Stream][${requestId}] Failed to log assistant response:`, assistantInsertRes.error);
          }

          console.log(`[Chat Stream][${requestId}] Transaction logged successfully.`);
        } catch (dbErr) {
          console.error(`[Chat Stream][${requestId}] Background DB logging failed:`, dbErr);
        }
      },
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of result.textStream) {
            controller.enqueue(encoder.encode(chunk));
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
