import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateText, embed } from 'ai';
import { google } from '@ai-sdk/google';
import { sendConsolidatedLeadEmail } from '@/lib/lead-notifier';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://tkoasyjvrgaglofpzduq.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: NextRequest) {
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  const { searchParams } = new URL(request.url);
  const chatbotId = searchParams.get('chatbotId');

  // 1. Verify Authorization Header for Security
  const authHeader = request.headers.get('authorization');
  const expectedBearerToken = process.env.OPENCLAW_BEARER_TOKEN || 'openclaw_secret_bearer_key_to_styleflo_api';

  if (!authHeader || (authHeader !== `Bearer ${expectedBearerToken}` && authHeader !== 'Bearer openclaw_secret_bearer_key_to_styleflo_api')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!chatbotId) {
    return NextResponse.json({ error: 'Missing chatbotId reference parameter' }, { status: 400 });
  }

  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { senderId, messageText, channelType = 'generic', mediaUrls } = await request.json();

    if (!senderId || !messageText) {
      return NextResponse.json({ error: 'Missing required payload fields: senderId or messageText' }, { status: 400 });
    }

    // 2. Resolve Chatbot and Tenant Isolation boundary
    const { data: chatbot, error: botError } = await supabaseAdmin
      .from('chatbots')
      .select('*, tenant:tenants(*)')
      .eq('id', chatbotId)
      .single();

    if (botError || !chatbot) {
      return NextResponse.json({ error: 'Target chatbot not found on file' }, { status: 404 });
    }

    const tenantId = chatbot.tenant_id;

    // 3. Resolve Session / Create session for user mapping
    const sessionKey = `styleflo_openclaw_${channelType}_${senderId}`;

    let { data: conversation } = await supabaseAdmin
      .from('conversations')
      .select('*')
      .eq('chatbot_id', chatbotId)
      .eq('tenant_id', tenantId)
      .eq('user_session_id', sessionKey)
      .maybeSingle();

    if (!conversation) {
      const { data: newConv, error: createError } = await supabaseAdmin
        .from('conversations')
        .insert({
          chatbot_id: chatbotId,
          tenant_id: tenantId,
          user_session_id: sessionKey,
        })
        .select()
        .single();

      if (createError) throw createError;
      conversation = newConv;
    }

    // Save Customer's Incoming Message
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversation.id,
      tenant_id: tenantId,
      sender_role: 'user',
      content: messageText
    });

    // 4. Generate Semantic Embeddings for RAG search
    let contextText = '';
    try {
      const { embedding } = await embed({
        model: google.textEmbeddingModel('text-embedding-004'),
        value: messageText,
      });

      // Query Supabase vector similarity search matching target chatbot & tenant
      const { data: chunks } = await supabaseAdmin.rpc('match_documents', {
        query_embedding: embedding,
        match_threshold: 0.35,
        match_count: 4,
        targeting_tenant_id: tenantId,
        targeting_chatbot_id: chatbotId
      });

      if (chunks && chunks.length > 0) {
        contextText = chunks.map((c: any) => c.content).join('\n');
      }
    } catch (embedError) {
      console.warn('[OpenClaw Webhook] Semantic search fallback:', embedError);
      // Fallback: load latest document chunks for this chatbot
      const { data: fallbackChunks } = await supabaseAdmin
        .from('document_chunks')
        .select('content')
        .eq('chatbot_id', chatbotId)
        .limit(4);
      
      if (fallbackChunks) {
        contextText = fallbackChunks.map((c: any) => c.content).join('\n');
      }
    }

    // Fetch Last 10 conversation transcripts for conversational context
    const { data: history } = await supabaseAdmin
      .from('messages')
      .select('sender_role, content')
      .eq('conversation_id', conversation.id)
      .order('created_at', { ascending: false })
      .limit(10);

    const historyPrompt = history
      ? history.slice().reverse().map((h: any) => `${h.sender_role === 'user' ? 'Customer' : 'Assistant'}: ${h.content}`).join('\n')
      : '';

    // 5. Invoke Gemini LLM with strict compliance rules
    const systemInstruction = `
You are the official AI Assistant for ${chatbot.name || 'our business'}.
You are speaking on a chat client (${channelType}). You assist clients with scheduling appointments, checking staff and service availability, answering service questions, and managing bookings.
Keep messages highly concise, conversational, and direct.

CRITICAL INSTRUCTIONS:
1. Strictly answer the question using ONLY the provided business context:
"${contextText}"

2. Keep formatting plain. DO NOT use markdown, bold text (no asterisks), bullet points, or special formatting. It will crash the messaging client WebSockets.
3. If you do not know the answer, state that you cannot locate that information.
4. If the user wants to book, direct them politely to their scheduling options.
`;

    const { text: aiResponse } = await generateText({
      model: google('gemini-flash-latest'),
      system: systemInstruction,
      prompt: `Conversation History:\n${historyPrompt}\n\nCustomer Message: ${messageText}`
    });

    // Strip markdown characters (*, #, `, _, -) to preserve raw text messaging client compatibility
    const cleanAiResponse = aiResponse.replace(/[*#`_-]/g, '').trim();

    // Log the Assistant's Outbound Message to DB
    await supabaseAdmin.from('messages').insert({
      conversation_id: conversation.id,
      tenant_id: tenantId,
      sender_role: 'assistant',
      content: cleanAiResponse
    });

    // Check if customer provided email/phone contact details and send consolidated notification
    const emailMatch = messageText.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i);
    const phoneMatch = messageText.match(/(?:(?:\+|00)\d{1,3}[\s-]*)?(?:0|\(\d+\))?[\s-]*\d{3,4}[\s-]*\d{3,4,5}/);
    if (emailMatch || phoneMatch) {
      try {
        await sendConsolidatedLeadEmail({
          tenantId,
          chatbotId,
          conversationId: conversation.id,
          newContactInfo: messageText,
          channelType: 'openclaw',
        });
      } catch (leadErr) {
        console.error('[OpenClaw Webhook] Lead notification error:', leadErr);
      }
    }

    // 6. Return response to OpenClaw Gateway as simple plain text JSON
    return NextResponse.json({ reply: cleanAiResponse }, { status: 200 });

  } catch (error: any) {
    console.error('OpenClaw Callback Execution Error:', error);
    return NextResponse.json({ error: error.message || 'Internal pipeline malfunction' }, { status: 500 });
  }
}
