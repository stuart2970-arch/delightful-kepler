import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { evaluateVoiceGate, getVapiPrivateKey, requireConfiguredAppUrl } from '@/lib/env/vapi-config';
import { sealWebCallAssistant } from '@/lib/voice/vapi-server';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

function adminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  try {
    const voiceGate = evaluateVoiceGate();
    if (!voiceGate.allowed) {
      return NextResponse.json({ error: voiceGate.reason }, { status: 403, headers: corsHeaders });
    }

    const appUrl = requireConfiguredAppUrl();
    if (!appUrl.ok) {
      return NextResponse.json({ error: appUrl.error }, { status: 500, headers: corsHeaders });
    }
    const secret = (process.env.VAPI_WEBHOOK_SECRET || '').trim();
    if (!secret) {
      return NextResponse.json({ error: 'VAPI_WEBHOOK_SECRET is not configured.' }, { status: 503, headers: corsHeaders });
    }
    const privateKey = getVapiPrivateKey();
    if (!privateKey) {
      return NextResponse.json({ error: 'Voice is currently unavailable.' }, { status: 503, headers: corsHeaders });
    }

    const body = await request.json().catch(() => null);
    const chatbotId = typeof body?.chatbotId === 'string' ? body.chatbotId.trim() : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(chatbotId)) {
      return NextResponse.json({ error: 'chatbotId is required' }, { status: 400, headers: corsHeaders });
    }

    const supabase = adminClient();
    const { data: chatbot, error } = await supabase
      .from('chatbots')
      .select('id, tenant_id')
      .eq('id', chatbotId)
      .maybeSingle();
    if (error || !chatbot?.tenant_id) {
      return NextResponse.json({ error: 'Chatbot not found' }, { status: 404, headers: corsHeaders });
    }

    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId.trim().slice(0, 200) : '';
    const clientAssistant = body?.assistant && typeof body.assistant === 'object' ? body.assistant : {};
    const assistant = sealWebCallAssistant(clientAssistant, {
      url: `${appUrl.url}/api/webhooks/vapi`,
      secret,
    });
    const metadata = {
      ...(assistant.metadata && typeof assistant.metadata === 'object' ? assistant.metadata : {}),
      tenant_id: chatbot.tenant_id,
      chatbot_id: chatbot.id,
      ...(sessionId ? { session_id: sessionId } : {}),
    };
    assistant.metadata = metadata;

    const vapiRes = await fetch('https://api.vapi.ai/call/web', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${privateKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ assistant }),
      signal: AbortSignal.timeout(15000),
    });
    if (!vapiRes.ok) {
      console.error('[Web Call] Vapi refused to create the call', { status: vapiRes.status, chatbotId });
      return NextResponse.json({ error: 'Could not start the voice call.' }, { status: 502, headers: corsHeaders });
    }
    const created = await vapiRes.json().catch(() => null);
    const id = typeof created?.id === 'string' ? created.id : '';
    const webCallUrl = typeof created?.webCallUrl === 'string' ? created.webCallUrl : '';
    if (!id || !webCallUrl) {
      console.error('[Web Call] Vapi response had no join URL', { chatbotId });
      return NextResponse.json({ error: 'Could not start the voice call.' }, { status: 502, headers: corsHeaders });
    }

    return NextResponse.json({ id, webCallUrl }, { headers: corsHeaders });
  } catch (err) {
    console.error('[Web Call] Failed to create call', {
      message: err instanceof Error ? err.message : 'unknown',
    });
    return NextResponse.json({ error: 'Could not start the voice call.' }, { status: 500, headers: corsHeaders });
  }
}
