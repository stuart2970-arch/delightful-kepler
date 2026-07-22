import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) throw new Error("Missing Supabase admin credentials");
  return createClient(supabaseUrl, serviceRoleKey);
}

export async function PATCH(req: NextRequest) {
  try {
    const supabase = createAdminClient();
    const { features } = await req.json();

    if (!Array.isArray(features)) {
      return NextResponse.json({ error: 'Invalid payload' }, { status: 400 });
    }

    // Update each feature's display_order
    const updatePromises = features.map((feature: { id: string, display_order: number }) => 
      supabase.from('features').update({ display_order: feature.display_order }).eq('id', feature.id)
    );

    await Promise.all(updatePromises);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[Features Reorder]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
