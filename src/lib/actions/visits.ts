'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth, hasRole } from '@/lib/auth';
import { ok, err, type ActionResult } from '@/lib/action-result';
import { getDeadlines } from '@/lib/config';
import {
  cancelOpenTasks,
  completeOpenTasks,
  createConfirmDateTask,
  TASK_TYPES_BY_ROLE,
} from '@/lib/workflow';
import type { MaintenanceVisit, VisitStatus } from '@/types/database';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function refresh() {
  revalidatePath('/', 'layout');
}

async function getVisit(visitId: string) {
  const { supabase, profile } = await requireAuth();
  const { data: visit } = await supabase
    .from('maintenance_visits')
    .select('*')
    .eq('id', visitId)
    .single();
  return { supabase, profile, visit: visit as MaintenanceVisit | null };
}

const isClosed = (v: MaintenanceVisit) => v.status === 'completed' || v.status === 'cancelled';

export async function createVisit(routineId: string, scheduledDate: string): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  if (!hasRole(profile, ['admin', 'vendor_coordinator'])) return err('Not allowed');
  if (!DATE_RE.test(scheduledDate)) return err('Enter a valid date');

  const { data: routine } = await supabase
    .from('maintenance_routines')
    .select('*')
    .eq('id', routineId)
    .single();
  if (!routine) return err('Routine not found');

  const { error } = await supabase.from('maintenance_visits').insert({
    routine_id: routineId,
    scheduled_date: scheduledDate,
    status: 'scheduled',
    vendor_coordinator_id: routine.vendor_coordinator_id,
    maintenance_engineer_id: routine.maintenance_engineer_id,
    technical_engineer_id: routine.technical_engineer_id,
  });
  if (error) return err(error.message);

  refresh();
  return ok('Visit created');
}

export async function confirmVisitDate(visitId: string, confirmedDate: string): Promise<ActionResult> {
  const { supabase, profile, visit } = await getVisit(visitId);
  if (!visit) return err('Visit not found');
  if (!DATE_RE.test(confirmedDate)) return err('Enter a valid date');
  if (visit.status !== 'scheduled') return err('Only scheduled visits can be confirmed');
  if (visit.vendor_coordinator_id !== profile.id && !hasRole(profile, 'admin')) {
    return err('Only the assigned vendor coordinator can confirm this visit');
  }

  const { error } = await supabase
    .from('maintenance_visits')
    .update({
      confirmed_date: confirmedDate,
      confirmed_at: new Date().toISOString(),
      status: 'date_confirmed' satisfies VisitStatus,
    })
    .eq('id', visitId);
  if (error) return err(error.message);

  // The coordinator has done this step — close their confirm task.
  await completeOpenTasks(supabase, visitId, 'confirm_visit_date');

  refresh();
  return ok('Visit date confirmed');
}

export async function saveNotificationNumber(visitId: string, value: string): Promise<ActionResult> {
  const { supabase, profile, visit } = await getVisit(visitId);
  if (!visit) return err('Visit not found');
  if (isClosed(visit)) return err('Visit is closed');
  if (visit.vendor_coordinator_id !== profile.id && !hasRole(profile, 'admin')) {
    return err('Not allowed');
  }

  const { error } = await supabase
    .from('maintenance_visits')
    .update({ notification_number: value.trim() || null })
    .eq('id', visitId);
  if (error) return err(error.message);

  refresh();
  return ok('Notification number saved');
}

export async function markNoReport(visitId: string, reason: string): Promise<ActionResult> {
  const { supabase, profile, visit } = await getVisit(visitId);
  if (!visit) return err('Visit not found');
  if (!reason.trim()) return err('A reason is required');
  if (isClosed(visit)) return err('Visit is closed');
  if (visit.vendor_coordinator_id !== profile.id && !hasRole(profile, 'admin')) {
    return err('Only the assigned vendor coordinator can do this');
  }

  const { error } = await supabase
    .from('maintenance_visits')
    .update({ no_report_reason: reason.trim(), status: 'report_uploaded' satisfies VisitStatus })
    .eq('id', visitId);
  if (error) return err(error.message);

  refresh();
  return ok('Marked as no report available');
}

export async function rescheduleVisit(
  visitId: string,
  newDate: string,
  reason: string,
): Promise<ActionResult> {
  const { supabase, profile, visit } = await getVisit(visitId);
  if (!visit) return err('Visit not found');
  if (!DATE_RE.test(newDate)) return err('Enter a valid date');
  if (!reason.trim()) return err('A reason is required');
  if (isClosed(visit)) return err('Visit is closed');
  if (visit.vendor_coordinator_id !== profile.id && !hasRole(profile, 'admin')) {
    return err('Only the assigned vendor coordinator can reschedule');
  }

  const oldDate = visit.scheduled_date;
  const { error } = await supabase
    .from('maintenance_visits')
    .update({
      scheduled_date: newDate,
      confirmed_date: null,
      status: 'scheduled' satisfies VisitStatus,
      reschedule_reason: reason.trim(),
      rescheduled_at: new Date().toISOString(),
      rescheduled_from: oldDate,
    })
    .eq('id', visitId);
  if (error) return err(error.message);

  await cancelOpenTasks(supabase, visitId, 'confirm_visit_date');
  const deadlines = await getDeadlines(supabase);
  await createConfirmDateTask(
    supabase,
    visitId,
    visit.vendor_coordinator_id,
    newDate,
    deadlines.visit_confirmation_days,
    `Rescheduled from ${oldDate}. Reason: ${reason.trim()}`,
  );

  refresh();
  return ok('Visit rescheduled');
}

export async function reassignTeam(
  visitId: string,
  team: {
    vendor_coordinator_id: string;
    maintenance_engineer_id: string;
    technical_engineer_id: string;
  },
): Promise<ActionResult> {
  const { supabase, profile, visit } = await getVisit(visitId);
  if (!visit) return err('Visit not found');
  if (!hasRole(profile, 'admin')) return err('Only admins can reassign the team');
  if (isClosed(visit)) return err('Visit is closed');
  if (!team.vendor_coordinator_id || !team.maintenance_engineer_id || !team.technical_engineer_id) {
    return err('All three team members are required');
  }

  const { error } = await supabase.from('maintenance_visits').update(team).eq('id', visitId);
  if (error) return err(error.message);

  // Move open tasks to the new assignees so work doesn't point at people who
  // are no longer on the visit.
  const roleChanges = [
    { types: TASK_TYPES_BY_ROLE.vendor_coordinator, from: visit.vendor_coordinator_id, to: team.vendor_coordinator_id },
    { types: TASK_TYPES_BY_ROLE.maintenance_engineer, from: visit.maintenance_engineer_id, to: team.maintenance_engineer_id },
    { types: TASK_TYPES_BY_ROLE.technical_engineer, from: visit.technical_engineer_id, to: team.technical_engineer_id },
  ];
  for (const change of roleChanges) {
    if (change.from === change.to) continue;
    await supabase
      .from('tasks')
      .update({ assigned_to_id: change.to })
      .eq('visit_id', visitId)
      .eq('assigned_to_id', change.from)
      .in('task_type', change.types)
      .in('status', ['pending', 'in_progress', 'overdue']);
  }

  refresh();
  return ok('Team reassigned');
}

export async function closeVisit(visitId: string): Promise<ActionResult> {
  const { supabase, profile, visit } = await getVisit(visitId);
  if (!visit) return err('Visit not found');
  if (isClosed(visit)) return err('Visit is already closed');
  if (visit.maintenance_engineer_id !== profile.id && !hasRole(profile, 'admin')) {
    return err('Only the assigned maintenance engineer can close this visit');
  }

  const { data: recs } = await supabase
    .from('recommendations')
    .select('status')
    .eq('visit_id', visitId);
  const allDone =
    (recs?.length ?? 0) > 0 && recs!.every((r) => r.status === 'completed' || r.status === 'cancelled');
  if (!allDone) return err('All recommendations must be completed or cancelled first');

  const { error } = await supabase
    .from('maintenance_visits')
    .update({
      status: 'completed' satisfies VisitStatus,
      completed_at: new Date().toISOString(),
    })
    .eq('id', visitId);
  if (error) return err(error.message);

  await completeOpenTasks(supabase, visitId, 'close_visit');

  refresh();
  return ok('Visit closed');
}

export async function reopenVisit(visitId: string): Promise<ActionResult> {
  const { supabase, profile, visit } = await getVisit(visitId);
  if (!visit) return err('Visit not found');
  if (!hasRole(profile, 'admin')) return err('Only admins can reopen visits');
  if (visit.status !== 'completed') return err('Only completed visits can be reopened');

  const { data: recs } = await supabase
    .from('recommendations')
    .select('status')
    .eq('visit_id', visitId);
  const hasInReview = recs?.some((r) => r.status === 'in_review');
  const newStatus: VisitStatus = hasInReview ? 'in_review' : 'recommendations_created';

  const { error } = await supabase
    .from('maintenance_visits')
    .update({ status: newStatus, completed_at: null })
    .eq('id', visitId);
  if (error) return err(error.message);

  refresh();
  return ok('Visit reopened');
}

export async function deleteVisit(visitId: string): Promise<ActionResult> {
  const { supabase, profile, visit } = await getVisit(visitId);
  if (!visit) return err('Visit not found');
  if (!hasRole(profile, 'admin')) return err('Only admins can delete visits');

  // Remove stored report files first so they aren't orphaned in storage.
  const { data: reports } = await supabase
    .from('visit_reports')
    .select('file_path')
    .eq('visit_id', visitId);
  if (reports?.length) {
    await supabase.storage.from('reports').remove(reports.map((r) => r.file_path));
  }

  await supabase.from('recommendations').delete().eq('visit_id', visitId);
  await supabase.from('tasks').delete().eq('visit_id', visitId);
  await supabase.from('visit_reports').delete().eq('visit_id', visitId);
  const { error } = await supabase.from('maintenance_visits').delete().eq('id', visitId);
  if (error) return err(error.message);

  refresh();
  return ok('Visit deleted');
}
