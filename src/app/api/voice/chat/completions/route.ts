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

    if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
    }

    const body = await req.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json({ error: 'Invalid messages payload' }, { status: 400, headers: corsHeaders });
    }

    const sessionId = body.call?.id || body.sessionId || req.headers.get('x-vapi-call-id') || req.headers.get('x-session-id') || `voice_${chatbotId.substring(0, 8)}_${Date.now()}`;

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

    if (latestUserMessage && typeof latestUserMessage.content === 'string') {
      queryText = latestUserMessage.content;
      try {
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
          const { data: matchedChunks, error: matchError } = await supabaseAdmin.rpc('match_documents', {
            query_embedding: embedding,
            match_threshold: 0.2,
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
          content: `${msg.content}\n\nIMPORTANT INSTRUCTION: You are speaking through a Text-to-Speech engine. DO NOT use any markdown formatting, asterisks, bullet points, or special characters. Speak naturally in plain text.\n\nBUSINESS KNOWLEDGE:\n${ragContext}\n\nREGULATORY DISCLAIMER:\n${globalDisclaimer}`
        };
      }
      return msg;
    });

    // 5. LLM Generation
    const result = streamText({
      model: google('gemini-3.5-flash'),
      messages: enhancedMessages,
      temperature: 0.7,
    });

    let fullAiResponse = '';

    // 6. Stream back to Vapi in OpenAI format & Log to Supabase
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const textDelta of result.textStream) {
            if (textDelta) {
              fullAiResponse += textDelta;
              const chunk = {
                id: 'chatcmpl-vapi',
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: 'gemini-3.5-flash',
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
          }
          
          const finishChunk = {
            id: 'chatcmpl-vapi',
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'gemini-3.5-flash',
            choices: [{ delta: {}, index: 0, finish_reason: 'stop' }]
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
          controller.encode(`data: [DONE]\n\n`);
          controller.close();

          // Save voice session and speech messages to Supabase after stream finishes
          try {
            const { data: conv } = await supabaseAdmin.from('conversations').upsert({
              tenant_id: chatbot.tenant_id,
              chatbot_id: chatbotId,
              user_session_id: sessionId,
              is_voice_call: true,
              channel: 'web_voice'
            }, { onConflict: 'tenant_id, user_session_id' }).select('id').single();

            if (conv?.id) {
              const now = Date.now();
              if (queryText) {
                await supabaseAdmin.from('messages').insert({
                  tenant_id: chatbot.tenant_id,
                  conversation_id: conv.id,
                  sender_type: 'user',
                  text_content: queryText,
                  created_at: new Date(now - 1000).toISOString()
                });
              }
              if (fullAiResponse) {
                await supabaseAdmin.from('messages').insert({
                  tenant_id: chatbot.tenant_id,
                  conversation_id: conv.id,
                  sender_type: 'bot',
                  text_content: fullAiResponse,
                  created_at: new Date(now).toISOString()
                });
              }
            }
          } catch (dbErr) {
            console.error('[Vapi Custom LLM] Database voice logging error:', dbErr);
          }

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
