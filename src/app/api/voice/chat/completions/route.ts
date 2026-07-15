import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { streamText } from 'ai';
import { google } from '@ai-sdk/google';

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

    // Map GEMINI_API_KEY to GOOGLE_GENERATIVE_AI_API_KEY for the @ai-sdk/google provider and embeddings fetch
    if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
    }

    const body = await req.json();
    const { messages } = body; // standard OpenAI messages array payload from Vapi

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid messages payload' }, { status: 400, headers: corsHeaders });
    }

    // 1. Initialize Supabase Admin
    const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'] || process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Supabase configuration missing');
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

    let globalDisclaimer = '';
    if (chatbot.tenant_id) {
      const { data: tenant } = await supabaseAdmin
        .from('tenants')
        .select('global_voice_disclaimer')
        .eq('id', chatbot.tenant_id)
        .single();
      globalDisclaimer = tenant?.global_voice_disclaimer || '';
    }

    // 3. Extract the latest user message for RAG embedding
    const latestUserMessage = messages.slice().reverse().find((m: any) => m.role === 'user');
    let ragContext = '';

    if (latestUserMessage && typeof latestUserMessage.content === 'string') {
      try {
        const queryText = latestUserMessage.content;
        
        // Convert to embedding using google's text-embedding-004
        const embeddingRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GOOGLE_GENERATIVE_AI_API_KEY}`, {
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
          // Localized RAG match_documents
          const { data: matchedChunks, error: matchError } = await supabaseAdmin.rpc('match_documents', {
            query_embedding: embedding,
            match_threshold: 0.7,
            match_count: 5,
            targeting_tenant_id: chatbot.tenant_id,
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
    const enhancedMessages = messages.map((msg: any) => {
      if (msg.role === 'system') {
        return {
          role: 'system',
          content: `${msg.content}\n\nBUSINESS KNOWLEDGE:\n${ragContext}\n\nREGULATORY DISCLAIMER:\n${globalDisclaimer}`
        };
      }
      return msg;
    });

    // 5. LLM Generation
    const result = streamText({
      model: google('gemini-2.5-flash'),
      messages: enhancedMessages,
      temperature: 0.7,
    });

    // 6. Stream back to Vapi in OpenAI format
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const textDelta of result.textStream) {
            const chunk = {
              id: 'chatcmpl-vapi',
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'gemini-2.5-flash',
              choices: [
                {
                  delta: { content: textDelta },
                  index: 0,
                  finish_reason: null
                }
              ]
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
          }
          
          const finishChunk = {
            id: 'chatcmpl-vapi',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'gemini-2.5-flash',
            choices: [
              {
                delta: {},
                index: 0,
                finish_reason: 'stop'
              }
            ]
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
          controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
          controller.close();
        } catch (err) {
          console.error('[Vapi Custom LLM] Stream error:', err);
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
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}
