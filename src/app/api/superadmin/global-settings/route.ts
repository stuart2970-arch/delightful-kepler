import { NextRequest, NextResponse } from 'next/server';
import { withSuperAdmin } from '@/lib/auth/require-superadmin';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

import { invalidateGeminiModelCache } from '@/lib/gemini-config';

export const POST = withSuperAdmin(async (req: NextRequest) => {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const body = await req.json();
    const { branding_html, branding_url, global_voice_disclaimer, default_gemini_model, flobot_config } = body;

    const adminClient = createClient(supabaseUrl, serviceKey);
    const globalBotId = '00000000-0000-0000-0000-000000000000';
    const globalTenantId = '00000000-0000-0000-0000-000000000000';

    // 1. Ensure global system tenant exists in tenants table to satisfy foreign key constraints
    const { error: tenantError } = await adminClient
      .from('tenants')
      .upsert({
        id: globalTenantId,
        tenant_id: globalTenantId,
        company_name: 'GLOBAL_PLATFORM_SYSTEM'
      }, { onConflict: 'id' });

    if (tenantError) {
      console.error('[Global Settings API] Error ensuring system tenant:', tenantError);
      return NextResponse.json({ error: 'Failed to initialize global tenant record: ' + tenantError.message }, { status: 500 });
    }

    // 2. Fetch existing config
    const { data: existingBot } = await adminClient
      .from('chatbots')
      .select('configuration_json')
      .eq('id', globalBotId)
      .maybeSingle();

    const newConfig = {
      ...(existingBot?.configuration_json || {}),
      ...(branding_html !== undefined && { branding_html }),
      ...(branding_url !== undefined && { branding_url }),
      ...(global_voice_disclaimer !== undefined && { global_voice_disclaimer }),
      ...(default_gemini_model !== undefined && { default_gemini_model: String(default_gemini_model).trim() }),
      ...(flobot_config !== undefined && {
        flobot_config: {
          ...(existingBot?.configuration_json?.flobot_config || {}),
          ...flobot_config
        }
      }),
    };

    invalidateGeminiModelCache();

    // 3. Upsert global chatbot configuration
    const { error } = await adminClient
      .from('chatbots')
      .upsert({
        id: globalBotId,
        tenant_id: globalTenantId,
        name: 'GLOBAL_PLATFORM_SETTINGS',
        primary_color: '#000000',
        configuration_json: newConfig
      }, { onConflict: 'id' });

    if (error) {
      console.error('[Global Settings API] Error updating:', error);
      return NextResponse.json({ error: error.message || 'Failed to update settings' }, { status: 500 });
    }

    return NextResponse.json({ success: true, configuration: newConfig });
  } catch (err: any) {
    console.error('[Global Settings API] Unexpected failure:', err);
    return NextResponse.json({ error: err?.message || 'Internal server error' }, { status: 500 });
  }
});
