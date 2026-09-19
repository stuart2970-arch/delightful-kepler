import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { generateText, embed } from 'ai';
import { google } from '@ai-sdk/google';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    'https://tkoasyjvrgaglofpzduq.supabase.co';
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase service role environment variables are missing');
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: NextRequest) {
  if (process.env.GEMINI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }

  const startTime = Date.now();

  try {
    const body = await request.json();
    const {
      tenantId,
      chatbotId: requestedChatbotId,
      channel = 'whatsapp',
      messageText = 'Hi, what services do you offer and how can I book?',
      customerIdentifier = '+447999888777',
      customerName = 'Test Reviewer',
    } = body;

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();

    // 1. Fetch Tenant and Chatbot
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('*')
      .eq('id', tenantId)
      .maybeSingle();

    let chatbot: any = null;
    if (requestedChatbotId) {
      const { data: bot } = await supabaseAdmin
        .from('chatbots')
        .select('*')
        .eq('id', requestedChatbotId)
        .maybeSingle();
      chatbot = bot;
    }

    if (!chatbot) {
      const { data: bot } = await supabaseAdmin
        .from('chatbots')
        .select('*')
        .eq('tenant_id', tenantId)
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      chatbot = bot;
    }

    const botName = chatbot?.name || tenant?.company_name || 'StyleFlo Assistant';
    const chatbotId = chatbot?.id;

    // 2. Resolve or Create Conversation Session
    const prefix = channel === 'whatsapp' ? 'wa_' : channel === 'instagram' ? 'ig_' : 'messenger_';
    const userSessionId = `${prefix}test_${customerIdentifier.replace(/[^\w]/g, '')}`;

    let conversationId: string | null = null;
    if (chatbotId) {
      const { data: existingConv } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('chatbot_id', chatbotId)
        .eq('tenant_id', tenantId)
        .eq('user_session_id', userSessionId)
        .maybeSingle();

      if (existingConv) {
        conversationId = existingConv.id;
      } else {
        const { data: newConv } = await supabaseAdmin
          .from('conversations')
          .insert({
            chatbot_id: chatbotId,
            tenant_id: tenantId,
            user_session_id: userSessionId,
          })
          .select('id')
          .single();

        if (newConv) {
          conversationId = newConv.id;
        }
      }

      // Record simulated user message
      if (conversationId) {
        await supabaseAdmin.from('messages').insert({
          conversation_id: conversationId,
          tenant_id: tenantId,
          sender_role: 'user',
          content: messageText,
        });
      }
    }

    // 3. RAG Retrieval via Vector Search
    let contextChunks: any[] = [];
    let contextText = '';

    if (chatbotId) {
      try {
        const { embedding } = await embed({
          model: google.textEmbeddingModel('text-embedding-004'),
          value: messageText,
        });

        const { data: chunks } = await supabaseAdmin.rpc('match_documents', {
          query_embedding: embedding,
          match_threshold: 0.35,
          match_count: 4,
          targeting_tenant_id: tenantId,
          targeting_chatbot_id: chatbotId,
        });

        if (chunks && chunks.length > 0) {
          contextChunks = chunks;
          contextText = chunks.map((c: any) => c.content).join('\n');
        }
      } catch (err: any) {
        console.warn('[Meta Test Journey] RAG fallback:', err.message);
        const { data: fallbackChunks } = await supabaseAdmin
          .from('document_chunks')
          .select('content')
          .eq('chatbot_id', chatbotId)
          .limit(4);

        if (fallbackChunks) {
          contextChunks = fallbackChunks;
          contextText = fallbackChunks.map((c: any) => c.content).join('\n');
        }
      }
    }

    // 4. Fetch Message History
    let historyPrompt = '';
    if (conversationId) {
      const { data: history } = await supabaseAdmin
        .from('messages')
        .select('sender_role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(6);

      if (history) {
        historyPrompt = history
          .slice()
          .reverse()
          .map((h: any) => `${h.sender_role === 'user' ? 'Customer' : 'Assistant'}: ${h.content}`)
          .join('\n');
      }
    }

    // 5. Generate AI Response
    const channelName =
      channel === 'whatsapp'
        ? 'WhatsApp'
        : channel === 'instagram'
        ? 'Instagram DM'
        : 'Facebook Messenger';

    const systemInstruction = `
You are the official 24/7 AI Assistant for ${botName}.
You are interacting with a client via ${channelName}.
Customer Name: ${customerName}.

YOUR GOAL:
Provide warm, professional, helpful assistance. Answer questions regarding services, pricing, appointments, opening hours, or general inquiries.

RULES FOR MESSAGING APPS (${channelName}):
1. Keep replies conversational, helpful, and concise (1 to 3 short paragraphs or clear bullet points).
2. Emojis are encouraged and natural for ${channelName}.
3. NO markdown headers (#), HTML tags, or excessive formatting. Plain clean text with simple bullet points (- or •) is best.
4. If you have knowledge context, use it accurately:
"""
${contextText}
"""
5. If the customer wants to book, guide them to provide their preferred date, time, and service or visit the booking link.
`;

    let replyText = `Hi ${customerName}! Thanks for reaching out to ${botName}. How can I help you today? 😊`;

    const { text: aiResponse } = await generateText({
      model: google('gemini-flash-latest'),
      system: systemInstruction,
      prompt: `Recent Chat History:\n${historyPrompt}\n\nLatest Customer Message: ${messageText}`,
    });

    if (aiResponse) {
      replyText = aiResponse.trim();
    }

    // 6. Record simulated assistant reply
    if (conversationId) {
      await supabaseAdmin.from('messages').insert({
        conversation_id: conversationId,
        tenant_id: tenantId,
        sender_role: 'assistant',
        content: replyText,
      });
    }

    const durationMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      channel,
      botName,
      userSessionId,
      conversationId,
      incomingMessage: messageText,
      replyText,
      contextChunksCount: contextChunks.length,
      latencyMs: durationMs,
      timestamp: new Date().toISOString(),
      status: 'verified_active',
    });
  } catch (error: any) {
    console.error('[Meta Test Journey API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Simulation failed' },
      { status: 500 }
    );
  }
}
