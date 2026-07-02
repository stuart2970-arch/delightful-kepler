import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get('tenantId');

    if (!tenantId) {
      return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('tenant_integrations')
      .select('id, provider, updated_at')
      .eq('tenant_id', tenantId)
      .eq('provider', 'google_calendar')
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "No rows found"
      throw error;
    }

    return NextResponse.json({
      connected: !!data,
      integration: data || null
    });
  } catch (err: any) {
    console.error('Error fetching integration status:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
