import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return NextResponse.json({}, { headers: corsHeaders });
}

// Initialize Supabase Admin Client using service role key
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

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate UUID format
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid chatbot ID format' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const globalSettingsId = '00000000-0000-0000-0000-000000000000';
    const { data: chatbots, error: chatbotError } = await supabaseAdmin
      .from('chatbots')
      .select('id, name, primary_color, configuration_json')
      .in('id', [id, globalSettingsId]);

    if (chatbotError || !chatbots || chatbots.length === 0) {
      console.warn(`[Chatbot Config API] Error fetching chatbots: ${id}`);
      return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
    }

    const chatbot = chatbots.find(b => b.id === id);
    if (!chatbot) {
      return NextResponse.json({ error: 'Chatbot not found' }, { status: 404 });
    }

    const globalBot = chatbots.find(b => b.id === globalSettingsId);
    const globalConfig = (globalBot?.configuration_json || {}) as Record<string, any>;
    const config = (chatbot.configuration_json || {}) as Record<string, any>;

    return NextResponse.json({
      name: chatbot.name,
      primaryColor: chatbot.primary_color,
      agentName: config.agent_name || chatbot.name,
      agentRole: config.agent_role || 'AI Assistant',
      agentAvatarUrl: config.agent_avatar_url || '/avatars/avatar1.png',
      welcomeMessage: config.welcome_message || 'Hello! How can I help you today?',
      brandingHtml: globalConfig.branding_html || '<span style="opacity: 0.6; font-size: 11px;">⚡ Powered by <strong>StyleFlo</strong></span>',
      brandingUrl: globalConfig.branding_url || 'https://styleflo.ai',
    }, {
      headers: {
        ...corsHeaders,
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      }
    });
  } catch (err: any) {
    console.error('[Chatbot Config API] Unexpected failure:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate UUID format
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return NextResponse.json({ error: 'Invalid chatbot ID format' }, { status: 400 });
    }

    const body = await request.json();
    const { name, primary_color, configuration_json } = body;

    const supabaseAdmin = getSupabaseAdmin();
    const { data: chatbot, error: chatbotError } = await supabaseAdmin
      .from('chatbots')
      .update({
        name,
        primary_color,
        configuration_json,
      })
      .eq('id', id)
      .select()
      .single();

    if (chatbotError) {
      console.error('[Chatbot Config PATCH API] Error updating chatbot:', chatbotError);
      return NextResponse.json({ error: chatbotError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, chatbot });
  } catch (err: any) {
    console.error('[Chatbot Config PATCH API] Unexpected failure:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
