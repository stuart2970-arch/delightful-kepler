import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Database credentials not configured' }, { status: 503, headers: corsHeaders });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Fetch Foundation plan from subscription_tiers (foundation, fallback base_tier)
    const { data: tiers, error: tiersError } = await supabase
      .from('subscription_tiers')
      .select('id, name, monthly_price, yearly_price')
      .in('id', ['foundation', 'base_tier'])
      .eq('is_active', true);

    if (tiersError || !tiers || tiers.length === 0) {
      return NextResponse.json({ error: 'Pricing unavailable' }, { status: 503, headers: corsHeaders });
    }

    const foundationTier = tiers.find(t => t.id === 'foundation') || tiers.find(t => t.id === 'base_tier');
    if (!foundationTier || foundationTier.monthly_price == null) {
      return NextResponse.json({ error: 'Pricing unavailable' }, { status: 503, headers: corsHeaders });
    }

    // 2. Fetch active add-ons from addon_catalog (excluding whatsapp_primary)
    const { data: addons, error: addonsError } = await supabase
      .from('addon_catalog')
      .select('id, name, description, category, monthly_price_pence, max_price_pence, price_step_pence, is_sliding, included_voice_minutes, max_voice_minutes, included_sms, max_sms, included_messages, included_data_chunks')
      .eq('is_active', true)
      .neq('id', 'whatsapp_primary')
      .order('display_order', { ascending: true });

    if (addonsError || !addons) {
      return NextResponse.json({ error: 'Pricing unavailable' }, { status: 503, headers: corsHeaders });
    }

    return NextResponse.json(
      {
        plan: {
          id: foundationTier.id,
          name: foundationTier.name || 'Foundation Plan',
          monthly_price: Number(foundationTier.monthly_price),
        },
        addons: addons.map(a => ({
          id: a.id,
          name: a.name,
          description: a.description,
          category: a.category,
          monthly_price_pence: a.monthly_price_pence,
          max_price_pence: a.max_price_pence,
          price_step_pence: a.price_step_pence,
          is_sliding: a.is_sliding,
          included_voice_minutes: a.included_voice_minutes,
          max_voice_minutes: a.max_voice_minutes,
          included_sms: a.included_sms,
          max_sms: a.max_sms,
          included_messages: a.included_messages,
          included_data_chunks: a.included_data_chunks,
        })),
      },
      { headers: corsHeaders }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Pricing unavailable' }, { status: 503, headers: corsHeaders });
  }
}
