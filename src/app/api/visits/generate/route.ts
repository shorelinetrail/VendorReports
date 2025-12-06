import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { addMonths, isBefore, isAfter, startOfDay, format } from 'date-fns';

// This route generates maintenance visits from active routines
// Can be called manually or via cron job

export async function POST(request: NextRequest) {
  try {
    // Verify authorization (either API key or authenticated admin)
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    // Allow if valid cron secret or if we'll verify session below
    const isCronJob = cronSecret && authHeader === `Bearer ${cronSecret}`;

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

      // Generate all scheduled dates from start until horizon
      let scheduledDate = startDate;
      const scheduledDates: Date[] = [];

      // Move forward to find dates that are relevant (not too far in the past)
      // Start from a reasonable point - go back one interval from today
      const lookbackDate = addMonths(today, -intervalMonths);

      while (isBefore(scheduledDate, lookbackDate)) {
        scheduledDate = addMonths(scheduledDate, intervalMonths);
      }

      // Now collect all dates from lookback through horizon
      while (isBefore(scheduledDate, horizonDate) || scheduledDate.getTime() === horizonDate.getTime()) {
        if (isAfter(scheduledDate, lookbackDate) || scheduledDate.getTime() === lookbackDate.getTime()) {
          scheduledDates.push(new Date(scheduledDate));
        }
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
          .single();

        if (!existingVisit) {
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

            // Only create task if due date is in the future
            if (isAfter(taskDueDate, today)) {
              await supabaseAdmin.from('tasks').insert({
                visit_id: newVisit.id,
                task_type: 'confirm_visit_date',
                assigned_to_id: routine.vendor_coordinator_id,
                status: 'pending',
                due_date: format(taskDueDate, 'yyyy-MM-dd'),
              });
            }
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
