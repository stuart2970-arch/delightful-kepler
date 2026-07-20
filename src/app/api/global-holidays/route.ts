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
    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('global_holidays')
      .select('*')
      .order('date', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ holidays: data || [] });
  } catch (err: any) {
    console.error('Error fetching global holidays:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { countries, date, name } = body;

    if (!countries || !Array.isArray(countries) || countries.length === 0 || !date || !name) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from('global_holidays')
      .insert({ countries, date, name })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ holiday: data });
  } catch (err: any) {
    console.error('Error creating global holiday:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Missing ID' }, { status: 400 });
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin
      .from('global_holidays')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Error deleting global holiday:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
