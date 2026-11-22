import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/utils/supabase-server';
import { createAdminClient } from '@/utils/supabase-admin';
import {
  onStaffGoogleCalendarIdChanged,
  runCalendarPushSideEffect,
} from '@/lib/calendar/push-sync/register-lifecycle';
import { STAFF_PUBLIC_COLUMNS, type StaffPublicRow } from '@/lib/staff/public-columns';

const STAFF_ME_SELECT = `${STAFF_PUBLIC_COLUMNS}, tenant:tenants(company_name)`;

export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Fetch the logged-in colleague's profile and linked staff data in a single request
    let { data, error } = await supabase
      .from('staff')
      .select(STAFF_ME_SELECT)
      .eq('user_id', user.id)
      .maybeSingle();
    let staffRow = data as StaffPublicRow | null;

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (!staffRow && user.email) {
      const { data: emailData, error: emailError } = await supabase
        .from('staff')
        .select(STAFF_ME_SELECT)
        .eq('email', user.email)
        .maybeSingle();
      if (emailError) return NextResponse.json({ error: emailError.message }, { status: 500 });

      const emailRow = emailData as StaffPublicRow | null;
      if (emailRow) {
        staffRow = emailRow;
        await supabase
          .from('staff')
          .update({ user_id: user.id })
          .eq('id', emailRow.id);
      }
    }

    if (!staffRow) {
      return NextResponse.json({ error: 'Colleague record not found' }, { status: 404 });
    }

    return NextResponse.json(staffRow);
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

    const { data: before } = await supabase
      .from('staff')
      .select('tenant_id, google_calendar_id')
      .eq('user_id', user.id)
      .maybeSingle();

    // Explicitly sanitize inputs: Colleague cannot mutate security, tenant boundaries, or permissions
    const safePayload: any = {
      name: payload.name,
      role: payload.role !== undefined ? payload.role : undefined,
      specialist_product: payload.specialist_product !== undefined ? payload.specialist_product : undefined,
      bio: payload.bio,
      avatar_url: payload.avatar_url,
      working_days: payload.working_days, // Manage local rota shifts
      google_calendar_id: payload.google_calendar_id,
    };
    Object.keys(safePayload).forEach(key => safePayload[key] === undefined && delete safePayload[key]);

    const { data, error } = await supabase
      .from('staff')
      .update(safePayload)
      .eq('user_id', user.id)
      .select(STAFF_PUBLIC_COLUMNS)
      .single();
    const updated = data as StaffPublicRow | null;

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    if (before && payload.google_calendar_id !== undefined) {
      const tenantId = String(before.tenant_id);
      const admin = createAdminClient();
      runCalendarPushSideEffect('staff profile calendar change', () =>
        onStaffGoogleCalendarIdChanged(
          admin,
          tenantId,
          before.google_calendar_id,
          updated?.google_calendar_id,
        ),
      );
    }

    return NextResponse.json(updated);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
