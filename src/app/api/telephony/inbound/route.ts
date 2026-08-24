import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error('Supabase admin environment variables are missing');
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey);
}

export async function POST(request: Request) {
  try {
    const supabase = getSupabaseAdmin();
    const formData = await request.formData();
    const to = formData.get('To') as string;
    
    if (!to) {
      console.error('[Telephony Inbound] No To number provided by Twilio');
      return new NextResponse('Invalid request', { status: 400 });
    }

    // 1. Find the tenant by the shadow number
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id')
      .eq('twilio_shadow_number', to)
      .single();

    if (tenantError || !tenant) {
      console.error(`[Telephony Inbound] No tenant found for number: ${to}`);
      // Fallback TwiML if no tenant found
      const VoiceResponse = twilio.twiml.VoiceResponse;
      const twiml = new VoiceResponse();
      twiml.say('Sorry, this number is not configured correctly. Goodbye.');
      return new NextResponse(twiml.toString(), {
        status: 200,
        headers: {
          'Content-Type': 'text/xml',
        },
      });
    }

    // 2. Find the Vapi assistant ID for this tenant
    // Assuming the tenant has one active voice-enabled chatbot
    const { data: chatbot, error: chatbotError } = await supabase
      .from('chatbots')
      .select('vapi_assistant_id')
      .eq('tenant_id', tenant.id)
      .not('vapi_assistant_id', 'is', null)
      .limit(1)
      .single();

    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();

    const assistantId = process.env.VAPI_MASTER_ASSISTANT_ID || chatbot?.vapi_assistant_id;

    if (chatbotError || !chatbot || !assistantId || assistantId.startsWith('vapi-')) {
      console.error(`[Telephony Inbound] No valid Vapi assistant configured for tenant: ${tenant.id}`);
      twiml.say('Sorry, the AI receptionist is currently unavailable. Please try again later.');
    } else {
      // 3. Connect the call to Vapi using the vapi_assistant_id
      const connect = twiml.connect();
      const stream = connect.stream({
        url: 'wss://api.vapi.ai/ws', // correct Vapi inbound WebSocket URL
      });
      stream.parameter({
        name: 'assistantId',
        value: assistantId
      });
    }

    return new NextResponse(twiml.toString(), {
      status: 200,
      headers: {
        'Content-Type': 'text/xml',
      },
    });

  } catch (error: any) {
    console.error('[Telephony Inbound API] Unexpected error:', error);
    const VoiceResponse = twilio.twiml.VoiceResponse;
    const twiml = new VoiceResponse();
    twiml.say('An unexpected error occurred. Please try again later.');
    return new NextResponse(twiml.toString(), {
        status: 500,
        headers: {
            'Content-Type': 'text/xml',
        },
    });
  }
}
