import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Helper to get admin client
const getSupabaseAdmin = () => {
  const supabaseUrl = process.env['NEXT_PUBLIC_' + 'SUPABASE_URL'];
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase env vars');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const chatbotId = searchParams.get('ref');
    const sourceHost = searchParams.get('source');

    // Fetch the global settings to determine the destination URL
    const supabaseAdmin = getSupabaseAdmin();
    const globalSettingsId = '00000000-0000-0000-0000-000000000000';
    
    let destinationUrl = 'https://styleflo.ai'; // Fallback
    
    const { data: globalBot } = await supabaseAdmin
      .from('chatbots')
      .select('configuration_json')
      .eq('id', globalSettingsId)
      .single();
      
    if (globalBot?.configuration_json) {
      const config = globalBot.configuration_json as Record<string, any>;
      if (config.branding_url) {
        destinationUrl = config.branding_url;
      }
    }

    // Log the click event (fire-and-forget so it doesn't block redirection)
    if (chatbotId) {
      // Append ref parameter to the destination URL
      const finalUrl = new URL(destinationUrl);
      finalUrl.searchParams.set('ref', chatbotId);
      if (sourceHost) finalUrl.searchParams.set('source', sourceHost);
      destinationUrl = finalUrl.toString();

      // Log it
      supabaseAdmin
        .from('referral_clicks')
        .insert({
          chatbot_id: chatbotId,
          source_host: sourceHost || 'unknown'
        })
        .then(({ error }) => {
          if (error) {
            console.error('[Tracking API] Failed to log referral click:', error);
          }
        });
    }

    // Perform 302 Redirect
    return NextResponse.redirect(destinationUrl, { status: 302 });
  } catch (err) {
    console.error('[Tracking API] Unexpected failure:', err);
    // Fallback to homepage on error
    return NextResponse.redirect('https://styleflo.ai', { status: 302 });
  }
}
