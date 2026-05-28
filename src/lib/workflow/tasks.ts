import { SupabaseClient } from '@supabase/supabase-js';
import { format, addDays } from 'date-fns';
import { TaskType } from '@/types/database';

// Helpers for advancing the per-visit task chain as the visit moves through its
// lifecycle. Used by both the visit detail page and the visits list page so the
// behaviour stays consistent. All writes go through the caller's (RLS-bound)
// client; the visit team is permitted to create/complete tasks on their visits.
//
// The client is intentionally left schema-untyped here: the generated Database
// generics make these generic write helpers infer `never` payloads.
type Client = SupabaseClient;

const OPEN_STATUSES = ['pending', 'in_progress', 'overdue'] as const;

async function configInt(supabase: Client, key: string, fallback: number): Promise<number> {
  const { data } = await supabase
    .from('system_config')
    .select('config_value')
    .eq('config_key', key)
    .maybeSingle<{ config_value: string }>();
  const n = parseInt(data?.config_value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Mark all open tasks of the given types on a visit as completed. */
export async function completeVisitTasks(supabase: Client, visitId: string, types: TaskType[]): Promise<void> {
  await supabase
    .from('tasks')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('visit_id', visitId)
    .in('task_type', types)
    .in('status', OPEN_STATUSES as unknown as string[]);
}

export async function createVisitTask(
  supabase: Client,
  visitId: string,
  type: TaskType,
  assignedToId: string | null | undefined,
  dueDate: Date,
  notes?: string | null,
): Promise<void> {
  if (!assignedToId) return;
  await supabase.from('tasks').insert({
    visit_id: visitId,
    task_type: type,
    assigned_to_id: assignedToId,
    status: 'pending',
    due_date: format(dueDate, 'yyyy-MM-dd'),
    notes: notes ?? null,
  });
}

/** Create the "upload report" task for the coordinator, due N days after the visit. */
export async function createUploadReportTask(
  supabase: Client,
  visitId: string,
  coordinatorId: string | null | undefined,
  fromDate: Date,
): Promise<void> {
  const days = await configInt(supabase, 'report_upload_days', 14);
  await createVisitTask(supabase, visitId, 'upload_report', coordinatorId, addDays(fromDate, days));
}

/** Create the "create recommendations" task for the maintenance engineer. */
export async function createRecommendationsTask(
  supabase: Client,
  visitId: string,
  engineerId: string | null | undefined,
): Promise<void> {
  const days = await configInt(supabase, 'recommendations_review_days', 7);
  await createVisitTask(supabase, visitId, 'create_recommendations', engineerId, addDays(new Date(), days));
}

/** Create a technical-review task for a specific recommendation, due N days out. */
export async function createTechnicalReviewTask(
  supabase: Client,
  visitId: string,
  technicalEngineerId: string | null | undefined,
  recommendationId: string,
): Promise<void> {
  const days = await configInt(supabase, 'technical_review_days', 7);
  await createVisitTask(
    supabase,
    visitId,
    'technical_review',
    technicalEngineerId,
    addDays(new Date(), days),
    `Review recommendation: ${recommendationId}`,
  );
}

/** Create a "close visit" task for the maintenance engineer once the visit is ready to close. */
export async function createCloseVisitTask(
  supabase: Client,
  visitId: string,
  engineerId: string | null | undefined,
): Promise<void> {
  if (!engineerId) return;
  // Don't create a duplicate if one is already open.
  const { data } = await supabase
    .from('tasks')
    .select('id')
    .eq('visit_id', visitId)
    .eq('task_type', 'close_visit')
    .in('status', OPEN_STATUSES as unknown as string[]);
  if (data && data.length > 0) return;

  const days = await configInt(supabase, 'recommendations_review_days', 7);
  await createVisitTask(supabase, visitId, 'close_visit', engineerId, addDays(new Date(), days));
}
