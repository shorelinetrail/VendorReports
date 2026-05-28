import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Forwarding reassigns a visit's maintenance engineer. The scoped RLS update
// policy intentionally forbids removing yourself from a visit, so this runs
// server-side with the service role after verifying the caller is the visit's
// current maintenance engineer (or an admin).

async function getRequestUser() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          /* read-only here */
        },
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function POST(request: NextRequest) {
  try {
    const user = await getRequestUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { visit_id, to_id, comment } = await request.json();
    if (!visit_id || !to_id) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // Authorize: caller must be an admin or the visit's current maintenance engineer.
    const [{ data: profile }, { data: visit }] = await Promise.all([
      admin.from('users').select('role').eq('id', user.id).single(),
      admin.from('maintenance_visits').select('id, maintenance_engineer_id, status').eq('id', visit_id).single(),
    ]);

    if (!visit) {
      return NextResponse.json({ error: 'Visit not found' }, { status: 404 });
    }
    const isAdmin = profile?.role === 'admin';
    if (!isAdmin && visit.maintenance_engineer_id !== user.id) {
      return NextResponse.json({ error: 'Only the assigned maintenance engineer or an admin can forward' }, { status: 403 });
    }

    // Target must be an active maintenance engineer or admin.
    const { data: target } = await admin
      .from('users')
      .select('id, full_name, role, is_active')
      .eq('id', to_id)
      .single();
    if (!target || target.is_active === false || !['maintenance_engineer', 'admin'].includes(target.role)) {
      return NextResponse.json({ error: 'Invalid forward target' }, { status: 400 });
    }

    // Reassign the visit's maintenance engineer.
    const { error: updateError } = await admin
      .from('maintenance_visits')
      .update({ maintenance_engineer_id: to_id })
      .eq('id', visit_id);
    if (updateError) throw new Error(updateError.message);

    // Reassign any open create-recommendations task (or create one) with the note.
    const note = `Forwarded by ${user.email ?? 'maintenance engineer'}${comment ? `: ${comment}` : ''}`;
    const { data: openTasks } = await admin
      .from('tasks')
      .select('id')
      .eq('visit_id', visit_id)
      .eq('task_type', 'create_recommendations')
      .in('status', ['pending', 'in_progress', 'overdue']);

    if (openTasks && openTasks.length > 0) {
      await admin
        .from('tasks')
        .update({ assigned_to_id: to_id, notes: note })
        .in('id', openTasks.map((t: { id: string }) => t.id));
    } else {
      const { data: cfg } = await admin
        .from('system_config')
        .select('config_value')
        .eq('config_key', 'recommendations_review_days')
        .maybeSingle();
      const days = parseInt(cfg?.config_value ?? '7', 10) || 7;
      const due = new Date();
      due.setDate(due.getDate() + days);
      await admin.from('tasks').insert({
        visit_id,
        task_type: 'create_recommendations',
        assigned_to_id: to_id,
        status: 'pending',
        due_date: due.toISOString().split('T')[0],
        notes: note,
      });
    }

    return NextResponse.json({ success: true, to: target.full_name });
  } catch (error) {
    console.error('Error forwarding visit:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to forward' },
      { status: 500 }
    );
  }
}
