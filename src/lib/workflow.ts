import { addDays, addMonths, format, startOfDay, subDays } from 'date-fns';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getDeadlines } from '@/lib/config';
import { asDate, todayISO } from '@/lib/labels';
import type { TaskType, UserRole } from '@/types/database';

// Domain logic shared by server actions and the cron routes.

export async function createTask(
  supabase: SupabaseClient,
  task: {
    visit_id: string;
    task_type: TaskType;
    assigned_to_id: string;
    due_date: string;
    notes?: string | null;
  },
) {
  return supabase.from('tasks').insert({ status: 'pending', notes: null, ...task });
}

/** Mark any open task of the given type on a visit as completed. */
export async function completeOpenTasks(
  supabase: SupabaseClient,
  visitId: string,
  taskType: TaskType,
  assignedToId?: string,
) {
  let query = supabase
    .from('tasks')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('visit_id', visitId)
    .eq('task_type', taskType)
    .in('status', ['pending', 'in_progress', 'overdue']);
  if (assignedToId) query = query.eq('assigned_to_id', assignedToId);
  return query;
}

/** Cancel any open task of the given type on a visit. */
export async function cancelOpenTasks(supabase: SupabaseClient, visitId: string, taskType: TaskType) {
  return supabase
    .from('tasks')
    .update({ status: 'cancelled' })
    .eq('visit_id', visitId)
    .eq('task_type', taskType)
    .in('status', ['pending', 'in_progress', 'overdue']);
}

/**
 * When every recommendation on a visit is completed/cancelled, remind the
 * maintenance engineer to close the visit (once).
 */
export async function maybeCreateCloseVisitTask(supabase: SupabaseClient, visitId: string) {
  const { data: recs } = await supabase.from('recommendations').select('status').eq('visit_id', visitId);
  if (!recs?.length) return;
  const allDone = recs.every((r) => r.status === 'completed' || r.status === 'cancelled');
  if (!allDone) return;

  const { data: visit } = await supabase
    .from('maintenance_visits')
    .select('maintenance_engineer_id, status')
    .eq('id', visitId)
    .single();
  if (!visit || visit.status === 'completed' || visit.status === 'cancelled') return;

  const { data: existing } = await supabase
    .from('tasks')
    .select('id')
    .eq('visit_id', visitId)
    .eq('task_type', 'close_visit')
    .limit(1);
  if (existing?.length) return;

  await createTask(supabase, {
    visit_id: visitId,
    task_type: 'close_visit',
    assigned_to_id: visit.maintenance_engineer_id,
    due_date: format(addDays(new Date(), 3), 'yyyy-MM-dd'),
    notes: 'All recommendations resolved. Please review and close the visit.',
  });
}

/** Create the technical_review task for a visit's technical engineer. */
export async function createTechnicalReviewTask(
  supabase: SupabaseClient,
  visitId: string,
  technicalEngineerId: string,
  recommendationId: string,
) {
  const deadlines = await getDeadlines(supabase);
  await createTask(supabase, {
    visit_id: visitId,
    task_type: 'technical_review',
    assigned_to_id: technicalEngineerId,
    due_date: format(addDays(new Date(), deadlines.technical_review_days), 'yyyy-MM-dd'),
    notes: `Review recommendation: ${recommendationId}`,
  });
}

/** Create the confirm_visit_date task, skipping deadlines already in the past. */
export async function createConfirmDateTask(
  supabase: SupabaseClient,
  visitId: string,
  coordinatorId: string,
  scheduledDate: string,
  confirmationDays: number,
  notes?: string,
) {
  const due = subDays(asDate(scheduledDate), confirmationDays);
  if (format(due, 'yyyy-MM-dd') <= todayISO()) return;
  await createTask(supabase, {
    visit_id: visitId,
    task_type: 'confirm_visit_date',
    assigned_to_id: coordinatorId,
    due_date: format(due, 'yyyy-MM-dd'),
    notes: notes ?? null,
  });
}

// Task types owned by each team role — used to move open tasks when a
// visit's team is reassigned.
export const TASK_TYPES_BY_ROLE: Record<
  Extract<UserRole, 'vendor_coordinator' | 'maintenance_engineer' | 'technical_engineer'>,
  TaskType[]
> = {
  vendor_coordinator: ['confirm_visit_date', 'upload_report'],
  maintenance_engineer: ['create_recommendations', 'close_visit'],
  technical_engineer: ['review_recommendations', 'technical_review'],
};

export interface GenerateResult {
  created: number;
  visits: string[];
  skipped: string[];
}

/**
 * The visit-generation engine: walks every active routine, projects scheduled
 * dates from start_date out to the call horizon, and creates any missing
 * visits plus their confirm-date task. Runs with the service-role client.
 */
export async function generateVisits(admin: SupabaseClient): Promise<GenerateResult> {
  const { data: routines, error } = await admin
    .from('maintenance_routines')
    .select('*')
    .eq('is_active', true);
  if (error) throw new Error(`Failed to fetch routines: ${error.message}`);
  if (!routines?.length) return { created: 0, visits: [], skipped: [] };

  const today = startOfDay(new Date());

  // One query for all existing (routine, date) pairs instead of one per date.
  const { data: existing, error: existingError } = await admin
    .from('maintenance_visits')
    .select('routine_id, scheduled_date')
    .in(
      'routine_id',
      routines.map((r) => r.id),
    );
  if (existingError) throw new Error(`Failed to fetch existing visits: ${existingError.message}`);
  const existingKeys = new Set((existing ?? []).map((v) => `${v.routine_id}|${v.scheduled_date}`));

  const deadlines = await getDeadlines(admin);
  const created: string[] = [];
  const skipped: string[] = [];

  for (const routine of routines) {
    const horizon = addMonths(today, routine.call_horizon_months || 2);
    const interval = routine.interval_months || 12;

    // Fast-forward to the next occurrence, then collect through the horizon.
    let date = startOfDay(asDate(routine.start_date));
    while (date < today) date = addMonths(date, interval);

    for (; date <= horizon; date = addMonths(date, interval)) {
      const dateStr = format(date, 'yyyy-MM-dd');
      if (existingKeys.has(`${routine.id}|${dateStr}`)) continue;

      const { data: visit, error: insertError } = await admin
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

      if (insertError || !visit) {
        skipped.push(`${routine.plan_number} (${dateStr}): ${insertError?.message ?? 'insert failed'}`);
        continue;
      }

      created.push(`${routine.plan_number} - ${dateStr}`);
      await createConfirmDateTask(
        admin,
        visit.id,
        routine.vendor_coordinator_id,
        dateStr,
        deadlines.visit_confirmation_days,
      );
    }
  }

  return { created: created.length, visits: created, skipped };
}
