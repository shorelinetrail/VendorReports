import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { addMonths, isBefore, isAfter, startOfDay, format } from 'date-fns';

// This route generates maintenance visits from active routines
// Can be called manually or via cron job

export async function POST(request: NextRequest) {
  try {
    // Verify authorization (either Vercel cron, API key, or authenticated admin)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    // Vercel cron jobs include this header
    const isVercelCron = request.headers.get('x-vercel-cron') === '1';

    // Allow if Vercel cron, valid cron secret, or if we'll verify session below
    const isCronJob = isVercelCron || (cronSecret && authHeader === `Bearer ${cronSecret}`);

    // Create admin client for database operations
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // If not a cron job, verify the user is an admin
    if (!isCronJob) {
      const sessionToken = request.cookies.get('sb-access-token')?.value;
      if (!sessionToken) {
        // Try to get session from auth header
        const token = authHeader?.replace('Bearer ', '');
        if (!token) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
          return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // Check if user is admin
        const { data: profile } = await supabaseAdmin
          .from('users')
          .select('role')
          .eq('id', user.id)
          .single();

        if (profile?.role !== 'admin') {
          return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
        }
      }
    }

    // Get all active maintenance routines
    const { data: routines, error: routinesError } = await supabaseAdmin
      .from('maintenance_routines')
      .select('*')
      .eq('is_active', true);

    if (routinesError) {
      throw new Error(`Failed to fetch routines: ${routinesError.message}`);
    }

    if (!routines || routines.length === 0) {
      return NextResponse.json({ message: 'No active routines found', created: 0 });
    }

    const today = startOfDay(new Date());
    const createdVisits: string[] = [];
    const skippedRoutines: string[] = [];

    for (const routine of routines) {
      // Calculate the horizon date (how far ahead to create visits)
      const horizonDate = addMonths(today, routine.call_horizon_months || 2);

      // Calculate all scheduled dates from start_date
      const startDate = startOfDay(new Date(routine.start_date));
      const intervalMonths = routine.interval_months || 12;

      // Generate scheduled dates - only future or today
      let scheduledDate = startDate;
      const scheduledDates: Date[] = [];

      // Fast-forward to find the next scheduled date that is today or in the future
      while (isBefore(scheduledDate, today)) {
        scheduledDate = addMonths(scheduledDate, intervalMonths);
      }

      // Now collect dates from today through horizon
      while (isBefore(scheduledDate, horizonDate) || scheduledDate.getTime() === horizonDate.getTime()) {
        scheduledDates.push(new Date(scheduledDate));
        scheduledDate = addMonths(scheduledDate, intervalMonths);
      }

      // Check which scheduled dates don't have visits yet
      for (const visitDate of scheduledDates) {
        const dateStr = format(visitDate, 'yyyy-MM-dd');

        // Check if a visit already exists for this routine and date
        const { data: existingVisit } = await supabaseAdmin
          .from('maintenance_visits')
          .select('id')
          .eq('routine_id', routine.id)
          .eq('scheduled_date', dateStr)
          .maybeSingle();

        // A visit may have been rescheduled away from this canonical date.
        // rescheduled_from preserves the original occurrence date, so don't
        // regenerate a duplicate for a slot that has already been moved.
        const { data: rescheduledAway } = await supabaseAdmin
          .from('maintenance_visits')
          .select('id')
          .eq('routine_id', routine.id)
          .eq('rescheduled_from', dateStr)
          .limit(1);

        if (!existingVisit && (!rescheduledAway || rescheduledAway.length === 0)) {
          // Create the visit
          const { data: newVisit, error: createError } = await supabaseAdmin
            .from('maintenance_visits')
            .insert({
              routine_id: routine.id,
              scheduled_date: dateStr,
              status: 'scheduled',
              vendor_coordinator_id: routine.vendor_coordinator_id,
              maintenance_engineer_id: routine.maintenance_engineer_id,
              technical_engineer_id: routine.technical_engineer_id,
            })
            .select('id')
            .single();

          if (createError) {
            console.error(`Failed to create visit for routine ${routine.plan_number}:`, createError);
            skippedRoutines.push(`${routine.plan_number} (${dateStr}): ${createError.message}`);
          } else if (newVisit) {
            createdVisits.push(`${routine.plan_number} - ${dateStr}`);

            // Create initial task for vendor coordinator to confirm date
            const { data: configData } = await supabaseAdmin
              .from('system_config')
              .select('config_value')
              .eq('config_key', 'visit_confirmation_days')
              .single();

            const confirmDays = parseInt(configData?.config_value || '14', 10);
            const taskDueDate = addMonths(visitDate, 0); // Same as visit date initially
            taskDueDate.setDate(taskDueDate.getDate() - confirmDays);

            // Always create the confirmation task. If the ideal due date has
            // already passed (visit generated inside the confirmation window),
            // clamp it to today so the coordinator still gets a task instead of
            // the visit silently having none.
            const effectiveDueDate = isAfter(taskDueDate, today) ? taskDueDate : today;
            await supabaseAdmin.from('tasks').insert({
              visit_id: newVisit.id,
              task_type: 'confirm_visit_date',
              assigned_to_id: routine.vendor_coordinator_id,
              status: 'pending',
              due_date: format(effectiveDueDate, 'yyyy-MM-dd'),
            });
          }
        }
      }
    }

    return NextResponse.json({
      message: `Generated ${createdVisits.length} visits`,
      created: createdVisits.length,
      visits: createdVisits,
      skipped: skippedRoutines,
    });

  } catch (error) {
    console.error('Error generating visits:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate visits' },
      { status: 500 }
    );
  }
}

// Also support GET for easy manual triggering (with auth check)
export async function GET(request: NextRequest) {
  return POST(request);
}
