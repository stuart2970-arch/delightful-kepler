import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withSuperAdmin } from '@/lib/auth/require-superadmin';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(supabaseUrl, serviceRoleKey);
}

export const PATCH = withSuperAdmin(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const body = await request.json();

    const allowedFields = [
      'external_voice_id',
      'name',
      'role',
      'gender',
      'nationality',
      'provider',
      'preview_url'
    ];

    const sanitizedData: Record<string, any> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        sanitizedData[field] = body[field];
      }
    }

    const supabaseAdmin = getSupabaseAdmin();
    const { data: persona, error } = await supabaseAdmin
      .from('voice_personas')
      .update(sanitizedData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Failed to update voice persona:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(persona);
  } catch (err: any) {
    console.error('Failed to update voice persona:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});

export const DELETE = withSuperAdmin(async (
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  try {
    const { id } = await params;
    const supabaseAdmin = getSupabaseAdmin();

    const { error } = await supabaseAdmin
      .from('voice_personas')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Failed to delete voice persona:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Failed to delete voice persona:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
});
