import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Creates an ad-hoc / breakdown visit (not tied to a routine). Any signed-in
// team member (coordinator, maintenance or technical engineer) or admin may
// raise one. Runs server-side with the service role so the initial task can be
// created for the chosen coordinator regardless of who is filing the breakdown.

async function getRequestUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const {
      vendor_id, scheduled_date, description, reason, requires_technical_review,
      vendor_coordinator_id, maintenance_engineer_id, technical_engineer_id,
    } = body;

    if (!vendor_id || !scheduled_date || !description ||
        !vendor_coordinator_id || !maintenance_engineer_id || !technical_engineer_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const { data: profile } = await admin.from('users').select('role').eq('id', user.id).single();
    const allowed = ['admin', 'vendor_coordinator', 'maintenance_engineer', 'technical_engineer'];
    if (!profile || !allowed.includes(profile.role)) {
      return NextResponse.json({ error: 'Not permitted to create visits' }, { status: 403 });
    }

    const now = new Date().toISOString();
    // Breakdown visits skip the confirmation step: the entered date is the
    // confirmed visit date, so the visit starts ready for report upload.
    const { data: visit, error: insertError } = await admin
      .from('maintenance_visits')
      .insert({
        routine_id: null,
        vendor_id,
        scheduled_date,
        confirmed_date: scheduled_date,
        confirmed_at: now,
        status: 'date_confirmed',
        vendor_coordinator_id,
        maintenance_engineer_id,
        technical_engineer_id,
        is_adhoc: true,
        adhoc_description: description,
        adhoc_reason: reason || null,
        requires_technical_review: requires_technical_review !== false,
      })
      .select('id')
      .single();

    if (insertError) throw new Error(insertError.message);

    // Queue the report-upload task for the coordinator.
    const { data: cfg } = await admin
      .from('system_config')
      .select('config_value')
      .eq('config_key', 'report_upload_days')
      .maybeSingle();
    const days = parseInt(cfg?.config_value ?? '14', 10) || 14;
    const due = new Date(scheduled_date);
    due.setDate(due.getDate() + days);
    await admin.from('tasks').insert({
      visit_id: visit.id,
      task_type: 'upload_report',
      assigned_to_id: vendor_coordinator_id,
      status: 'pending',
      due_date: due.toISOString().split('T')[0],
      notes: `Breakdown: ${description}`,
    });

    return NextResponse.json({ success: true, id: visit.id });
  } catch (error) {
    console.error('Error creating breakdown visit:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create breakdown visit' },
      { status: 500 }
    );
  }
}
