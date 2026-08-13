import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/utils/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch the logged-in colleague's profile and linked staff data in a single request
    const { data, error } = await supabase
      .from('staff')
      .select('*, tenant:tenants(company_name)')
      .eq('user_id', user.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Colleague record not found' }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const payload = await request.json();

    // Explicitly sanitize inputs: Colleague cannot mutate security, tenant boundaries, or permissions
    const safePayload = {
      name: payload.name,
      bio: payload.bio,
      avatar_url: payload.avatar_url,
      working_days: payload.working_days, // Manage local rota shifts
      google_calendar_id: payload.google_calendar_id,
    };

    const { data, error } = await supabase
      .from('staff')
      .update(safePayload)
      .eq('user_id', user.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
