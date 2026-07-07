'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth, hasRole } from '@/lib/auth';
import { ok, err, type ActionResult } from '@/lib/action-result';
import {
  completeOpenTasks,
  createTechnicalReviewTask,
  maybeCreateCloseVisitTask,
} from '@/lib/workflow';
import type {
  RecommendationStatus,
  ReviewDecisionType,
  VisitStatus,
} from '@/types/database';

function refresh() {
  revalidatePath('/', 'layout');
}

async function getRecommendationWithVisit(supabase: Awaited<ReturnType<typeof requireAuth>>['supabase'], recId: string) {
  const { data } = await supabase
    .from('recommendations')
    .select('*, visit:maintenance_visits(id, status, vendor_coordinator_id, maintenance_engineer_id, technical_engineer_id)')
    .eq('id', recId)
    .single();
  return data as
    | (Record<string, unknown> & {
        id: string;
        visit_id: string;
        status: RecommendationStatus;
        sent_for_review: boolean;
        review_decision: ReviewDecisionType | null;
        sap_notification_number: string | null;
        due_date: string | null;
        visit: {
          id: string;
          status: VisitStatus;
          vendor_coordinator_id: string;
          maintenance_engineer_id: string;
          technical_engineer_id: string;
        };
      })
    | null;
}

export async function createRecommendation(input: {
  visitId: string;
  description: string;
  sapNotificationNumber?: string;
  dueDate?: string;
}): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  if (!input.description.trim()) return err('A description is required');

  const { data: visit } = await supabase
    .from('maintenance_visits')
    .select(
      'id, status, maintenance_engineer_id, technical_engineer_id, no_report_reason, routine:maintenance_routines(requires_technical_review)',
    )
    .eq('id', input.visitId)
    .single();
  if (!visit) return err('Visit not found');
  if (visit.status === 'completed' || visit.status === 'cancelled') return err('Visit is closed');
  if (visit.maintenance_engineer_id !== profile.id && !hasRole(profile, 'admin')) {
    return err('Only the assigned maintenance engineer can add recommendations');
  }

  const routine = visit.routine as unknown as { requires_technical_review: boolean } | null;
  const requiresReview = routine?.requires_technical_review ?? true;
  const initialStatus: RecommendationStatus = requiresReview ? 'in_review' : 'open';

  const { data: rec, error } = await supabase
    .from('recommendations')
    .insert({
      visit_id: input.visitId,
      description: input.description.trim(),
      sap_notification_number: input.sapNotificationNumber?.trim() || null,
      due_date: input.dueDate || null,
      created_by_id: profile.id,
      status: initialStatus,
      sent_for_review: requiresReview,
    })
    .select('id')
    .single();
  if (error || !rec) return err(error?.message ?? 'Failed to create recommendation');

  await supabase
    .from('maintenance_visits')
    .update({ status: (requiresReview ? 'in_review' : 'recommendations_created') satisfies VisitStatus })
    .eq('id', input.visitId);

  if (requiresReview && visit.technical_engineer_id) {
    await createTechnicalReviewTask(supabase, input.visitId, visit.technical_engineer_id, rec.id);
  }

  // Creating recommendations is the engineer's post-report step — close their task.
  await completeOpenTasks(supabase, input.visitId, 'create_recommendations');

  refresh();
  return ok(requiresReview ? 'Recommendation sent for technical review' : 'Recommendation created');
}

export async function sendForReview(recId: string): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  const rec = await getRecommendationWithVisit(supabase, recId);
  if (!rec) return err('Recommendation not found');
  if (rec.status !== 'open' || rec.sent_for_review) return err('Already sent for review');
  if (rec.visit.maintenance_engineer_id !== profile.id && !hasRole(profile, 'admin')) {
    return err('Only the assigned maintenance engineer can send for review');
  }

  const { error } = await supabase
    .from('recommendations')
    .update({ sent_for_review: true, status: 'in_review' satisfies RecommendationStatus })
    .eq('id', recId);
  if (error) return err(error.message);

  await supabase
    .from('maintenance_visits')
    .update({ status: 'in_review' satisfies VisitStatus })
    .eq('id', rec.visit_id);

  if (rec.visit.technical_engineer_id) {
    await createTechnicalReviewTask(supabase, rec.visit_id, rec.visit.technical_engineer_id, recId);
  }

  refresh();
  return ok('Sent for technical review');
}

export async function submitReview(input: {
  recId: string;
  decision: ReviewDecisionType;
  response: string;
  actionDescription?: string;
  assignToId?: string;
}): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  if (!input.response.trim()) return err('A justification or comment is required');
  if (input.decision === 'other_action' && !input.actionDescription?.trim()) {
    return err('Describe the action required');
  }

  const rec = await getRecommendationWithVisit(supabase, input.recId);
  if (!rec) return err('Recommendation not found');
  if (rec.status !== 'in_review') return err('This recommendation is not awaiting review');
  if (rec.visit.technical_engineer_id !== profile.id && !hasRole(profile, 'admin')) {
    return err('Only the assigned technical engineer can review this');
  }

  const noAction = input.decision === 'no_action';
  const { error } = await supabase
    .from('recommendations')
    .update({
      technical_review_response: input.response.trim(),
      review_decision: input.decision,
      review_action_description: input.decision === 'other_action' ? input.actionDescription!.trim() : null,
      action_assigned_to_id: noAction ? null : input.assignToId || null,
      reviewed_by_id: profile.id,
      reviewed_at: new Date().toISOString(),
      status: (noAction ? 'completed' : 'approved') satisfies RecommendationStatus,
      completed_at: noAction ? new Date().toISOString() : null,
    })
    .eq('id', input.recId);
  if (error) return err(error.message);

  await completeOpenTasks(supabase, rec.visit_id, 'technical_review', profile.id);
  if (noAction) await maybeCreateCloseVisitTask(supabase, rec.visit_id);

  refresh();
  return ok('Review submitted');
}

export async function saveSapDetails(
  recId: string,
  sapNotificationNumber: string,
  dueDate: string,
): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  if (!sapNotificationNumber.trim() || !dueDate) {
    return err('SAP notification number and due date are required');
  }

  const rec = await getRecommendationWithVisit(supabase, recId);
  if (!rec) return err('Recommendation not found');
  if (rec.visit.maintenance_engineer_id !== profile.id && !hasRole(profile, 'admin')) {
    return err('Only the assigned maintenance engineer can add SAP details');
  }

  const { error } = await supabase
    .from('recommendations')
    .update({ sap_notification_number: sapNotificationNumber.trim(), due_date: dueDate })
    .eq('id', recId);
  if (error) return err(error.message);

  refresh();
  return ok('SAP details saved');
}

export async function completeRecommendation(recId: string): Promise<ActionResult> {
  const { supabase } = await requireAuth();
  const rec = await getRecommendationWithVisit(supabase, recId);
  if (!rec) return err('Recommendation not found');
  if (rec.status !== 'open' && rec.status !== 'approved') {
    return err('Only open or approved recommendations can be completed');
  }
  if (rec.review_decision === 'request_sap' && !rec.sap_notification_number) {
    return err('Add the SAP notification number and due date before completing');
  }

  const { error } = await supabase
    .from('recommendations')
    .update({
      status: 'completed' satisfies RecommendationStatus,
      completed_at: new Date().toISOString(),
    })
    .eq('id', recId);
  if (error) return err(error.message);

  await maybeCreateCloseVisitTask(supabase, rec.visit_id);

  refresh();
  return ok('Recommendation completed');
}

export async function cancelRecommendation(recId: string, reason: string): Promise<ActionResult> {
  const { supabase } = await requireAuth();
  if (!reason.trim()) return err('A cancellation reason is required');

  const rec = await getRecommendationWithVisit(supabase, recId);
  if (!rec) return err('Recommendation not found');
  if (rec.status !== 'open' && rec.status !== 'approved') {
    return err('Only open or approved recommendations can be cancelled');
  }

  const { error } = await supabase
    .from('recommendations')
    .update({
      status: 'cancelled' satisfies RecommendationStatus,
      cancelled_at: new Date().toISOString(),
      cancellation_reason: reason.trim(),
    })
    .eq('id', recId);
  if (error) return err(error.message);

  await maybeCreateCloseVisitTask(supabase, rec.visit_id);

  refresh();
  return ok('Recommendation cancelled');
}
