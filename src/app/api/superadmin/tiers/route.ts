import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase admin credentials");
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function GET() {
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.from('subscription_tiers').select('*').eq('is_active', true).order('created_at');
    if (error) throw error;
    return NextResponse.json({ data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { id, monthly_price, yearly_price } = await req.json();

    if (!id) {
      return NextResponse.json({ error: 'Missing tier id' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('subscription_tiers')
      .update({ 
        monthly_price: monthly_price !== undefined ? Number(monthly_price) : undefined,
        yearly_price: yearly_price !== undefined ? Number(yearly_price) : undefined
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, tier: data });
  } catch (err: any) {
    console.error('[Update Tier Pricing]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
