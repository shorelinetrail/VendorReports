import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Check, Clock } from 'lucide-react';
import { requireAuth, hasRole } from '@/lib/auth';
import {
  formatDate,
  formatDateTime,
  VISIT_STATUS_LABELS,
  VISIT_STATUS_VARIANTS,
  TASK_TYPE_LABELS,
} from '@/lib/labels';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import WorkflowActions from './WorkflowActions';
import ReportsList from './ReportsList';
import ReassignButton from './ReassignButton';
import EditNotificationButton from './EditNotificationButton';
import RecommendationsSection from './RecommendationsSection';
import type {
  RecommendationDetail,
  ReportDetail,
  TaskDetail,
  UserOption,
  VisitDetail,
  VisitPermissions,
} from './types';
import type { VisitStatus } from '@/types/database';

const WORKFLOW_STEPS = [
  { step: 1, label: 'Scheduled', description: 'Visit date set' },
  { step: 2, label: 'Date Confirmed', description: 'Vendor coordinator confirmed' },
  { step: 3, label: 'Report Uploaded', description: 'Maintenance report received' },
  { step: 4, label: 'Recommendations', description: 'Engineer created recommendations' },
  { step: 5, label: 'In Review', description: 'Technical review in progress' },
  { step: 6, label: 'Completed', description: 'Visit closed' },
];

const STATUS_STEP: Record<VisitStatus, number> = {
  scheduled: 1,
  date_confirmed: 2,
  report_uploaded: 3,
  recommendations_created: 4,
  in_review: 5,
  completed: 6,
  cancelled: 0,
};

function waitingFor(visit: VisitDetail): { name: string; action: string } | null {
  switch (visit.status) {
    case 'scheduled':
      return { name: visit.vendor_coordinator?.full_name ?? 'Vendor Coordinator', action: 'to confirm the visit date' };
    case 'date_confirmed':
      return { name: visit.vendor_coordinator?.full_name ?? 'Vendor Coordinator', action: 'to upload the maintenance report' };
    case 'report_uploaded':
      return { name: visit.maintenance_engineer?.full_name ?? 'Maintenance Engineer', action: 'to create recommendations' };
    case 'recommendations_created':
      return { name: visit.maintenance_engineer?.full_name ?? 'Maintenance Engineer', action: 'to resolve recommendations and close the visit' };
    case 'in_review':
      return { name: visit.technical_engineer?.full_name ?? 'Technical Engineer', action: 'to review recommendations' };
    default:
      return null;
  }
}

interface Activity {
  date: string;
  event: string;
  details?: string;
}

function buildActivityLog(
  visit: VisitDetail,
  reports: ReportDetail[],
  recommendations: RecommendationDetail[],
  tasks: TaskDetail[],
): Activity[] {
  const items: Activity[] = [];

  const originalDate = visit.rescheduled_from || visit.scheduled_date;
  items.push({
    date: visit.created_at,
    event: 'Visit created',
    details: `Scheduled for ${formatDate(originalDate)}`,
  });

  if (visit.confirmed_date) {
    items.push({
      date: visit.confirmed_at || visit.updated_at,
      event: 'Visit date confirmed',
      details: `Confirmed for ${formatDate(visit.confirmed_date)}`,
    });
  }

  if (visit.rescheduled_at) {
    let details = `From ${visit.rescheduled_from ? formatDate(visit.rescheduled_from) : 'previous date'} to ${formatDate(visit.scheduled_date)}`;
    if (visit.reschedule_reason) details += `. ${visit.reschedule_reason}`;
    items.push({ date: visit.rescheduled_at, event: 'Visit rescheduled', details });
  }

  for (const report of reports) {
    let details = report.file_name;
    if (report.uploaded_by?.full_name) details += ` (${report.uploaded_by.full_name})`;
    if (report.notes) details += `. ${report.notes}`;
    items.push({ date: report.uploaded_at, event: 'Report uploaded', details });
  }

  if (visit.no_report_reason && reports.length === 0) {
    items.push({ date: visit.updated_at, event: 'No report available', details: visit.no_report_reason });
  }

  for (const rec of recommendations) {
    const short = rec.description.length > 80 ? `${rec.description.slice(0, 80)}…` : rec.description;
    items.push({ date: rec.created_at, event: 'Recommendation created', details: short });
    if (rec.reviewed_at) {
      items.push({
        date: rec.reviewed_at,
        event: 'Recommendation reviewed',
        details: `By ${rec.reviewed_by?.full_name ?? 'Technical Engineer'}`,
      });
    }
    if (rec.completed_at) {
      items.push({
        date: rec.completed_at,
        event: 'Recommendation completed',
        details: rec.description.length > 40 ? `${rec.description.slice(0, 40)}…` : rec.description,
      });
    }
    if (rec.cancelled_at) {
      items.push({ date: rec.cancelled_at, event: 'Recommendation cancelled', details: rec.cancellation_reason ?? undefined });
    }
  }

  for (const task of tasks) {
    if (task.completed_at) {
      items.push({ date: task.completed_at, event: `${TASK_TYPE_LABELS[task.task_type]} task completed` });
    }
  }

  if (visit.completed_at) {
    items.push({ date: visit.completed_at, event: 'Visit closed' });
  }

  return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export default async function VisitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, profile } = await requireAuth();
  const { id: visitId } = await params;

  const [visitRes, recsRes, tasksRes, reportsRes] = await Promise.all([
    supabase
      .from('maintenance_visits')
      .select(
        `*,
        routine:maintenance_routines(id, plan_number, description, requires_technical_review, vendor:vendors(id, name)),
        vendor_coordinator:users!maintenance_visits_vendor_coordinator_id_fkey(id, full_name, email),
        maintenance_engineer:users!maintenance_visits_maintenance_engineer_id_fkey(id, full_name, email),
        technical_engineer:users!maintenance_visits_technical_engineer_id_fkey(id, full_name, email)`,
      )
      .eq('id', visitId)
      .single(),
    supabase
      .from('recommendations')
      .select(
        `*,
        created_by:users!recommendations_created_by_id_fkey(full_name),
        reviewed_by:users!recommendations_reviewed_by_id_fkey(full_name),
        action_assigned_to:users!recommendations_action_assigned_to_id_fkey(id, full_name)`,
      )
      .eq('visit_id', visitId)
      .order('created_at', { ascending: false }),
    supabase.from('tasks').select('*').eq('visit_id', visitId).order('due_date', { ascending: true }),
    supabase
      .from('visit_reports')
      .select('id, file_path, file_name, uploaded_at, notes, uploaded_by:users!visit_reports_uploaded_by_id_fkey(full_name)')
      .eq('visit_id', visitId)
      .order('uploaded_at', { ascending: false }),
  ]);

  if (!visitRes.data) notFound();
  const visit = visitRes.data as unknown as VisitDetail;
  const recommendations = (recsRes.data ?? []) as unknown as RecommendationDetail[];
  const tasks = (tasksRes.data ?? []) as TaskDetail[];
  const reports = (reportsRes.data ?? []) as unknown as ReportDetail[];

  // Permissions — the same rules Postgres RLS enforces, precomputed for the UI.
  const isAdmin = hasRole(profile, 'admin');
  const isCoordinator = profile.id === visit.vendor_coordinator_id;
  const isMaintenanceEngineer = profile.id === visit.maintenance_engineer_id;
  const isTechnicalEngineer = profile.id === visit.technical_engineer_id;
  const isOpen = visit.status !== 'completed' && visit.status !== 'cancelled';
  const hasReports = reports.length > 0 || !!visit.no_report_reason;
  const allRecsDone =
    recommendations.length > 0 && recommendations.every((r) => r.status === 'completed' || r.status === 'cancelled');

  const permissions: VisitPermissions = {
    isAdmin,
    isMaintenanceEngineer,
    canConfirmDate: visit.status === 'scheduled' && (isCoordinator || isAdmin),
    canUploadReport:
      (isCoordinator || isAdmin) && (visit.status === 'date_confirmed' || (reports.length > 0 && isOpen)),
    canCreateRecommendation: (isMaintenanceEngineer || isAdmin) && hasReports && isOpen,
    canReview: isTechnicalEngineer || isAdmin,
    canReschedule: (isCoordinator || isAdmin) && isOpen,
    canCloseVisit: (isMaintenanceEngineer || isAdmin) && isOpen && allRecsDone,
    canReopenVisit: isAdmin && visit.status === 'completed',
    canEditNotification: (isCoordinator || isAdmin) && isOpen,
    canReassign: isAdmin && isOpen,
  };

  // Only load the user directory when a modal actually needs it.
  let users: UserOption[] = [];
  if (permissions.canReassign || permissions.canReview) {
    const { data } = await supabase
      .from('users')
      .select('id, full_name, role')
      .eq('is_active', true)
      .order('full_name');
    users = (data ?? []) as UserOption[];
  }

  const currentStep = STATUS_STEP[visit.status] || 1;
  const waiting = isOpen ? waitingFor(visit) : null;
  const activities = buildActivityLog(visit, reports, recommendations, tasks);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3 sm:items-center sm:gap-4">
        <Link href="/visits" className="flex-shrink-0">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Back</span>
          </Button>
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-gray-900 sm:text-2xl">
            Visit: {visit.routine?.plan_number}
          </h1>
          <p className="line-clamp-2 text-sm text-gray-600 sm:text-base">{visit.routine?.description}</p>
        </div>
      </div>

      {/* Workflow stepper */}
      {visit.status !== 'cancelled' && (
        <Card>
          <CardContent className="px-2 py-4 sm:px-6 sm:py-6">
            <div className="-mx-2 overflow-x-auto px-2 pb-2">
              <div className="flex min-w-[500px] items-center justify-between sm:min-w-0">
                {WORKFLOW_STEPS.map((step, index) => {
                  const isCompleted = visit.status === 'completed';
                  const done = isCompleted || currentStep > step.step;
                  const current = !isCompleted && currentStep === step.step;
                  return (
                    <div key={step.step} className="flex flex-1 items-center">
                      <div className="flex flex-col items-center">
                        <div
                          className={`flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-medium transition-colors sm:h-10 sm:w-10 sm:text-sm ${
                            done
                              ? 'border-green-500 bg-green-500 text-white'
                              : current
                                ? 'border-blue-500 bg-blue-500 text-white'
                                : 'border-gray-300 bg-white text-gray-400'
                          }`}
                        >
                          {done ? <Check className="h-4 w-4 sm:h-5 sm:w-5" /> : step.step}
                        </div>
                        <div className="mt-1 max-w-[60px] text-center sm:mt-2 sm:max-w-none">
                          <p className={`text-[10px] font-medium leading-tight sm:text-xs ${done || current ? 'text-gray-900' : 'text-gray-400'}`}>
                            {step.label}
                          </p>
                          <p className="hidden text-xs text-gray-500 sm:block">{step.description}</p>
                        </div>
                      </div>
                      {index < WORKFLOW_STEPS.length - 1 && (
                        <div className={`mx-1 h-0.5 flex-1 sm:mx-2 sm:h-1 ${done ? 'bg-green-500' : 'bg-gray-200'}`} />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {waiting && (
              <div className="mt-3 border-t border-gray-200 pt-3 sm:mt-4 sm:pt-4">
                <div className="flex flex-wrap items-center justify-center gap-1 text-center text-xs sm:text-sm">
                  <Clock className="h-4 w-4 flex-shrink-0 text-amber-500" />
                  <span className="text-gray-600">Waiting for</span>
                  <span className="font-medium text-gray-900">{waiting.name}</span>
                  <span className="text-gray-600">{waiting.action}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Details + team */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 sm:gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 sm:pb-4">
            <CardTitle className="text-base sm:text-lg">Visit Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              <div>
                <p className="text-xs text-gray-500 sm:text-sm">Vendor</p>
                <p className="text-sm font-medium sm:text-base">{visit.routine?.vendor?.name}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 sm:text-sm">Status</p>
                <Badge variant={VISIT_STATUS_VARIANTS[visit.status]}>{VISIT_STATUS_LABELS[visit.status]}</Badge>
              </div>
              <div>
                <p className="text-xs text-gray-500 sm:text-sm">Scheduled Date</p>
                <p className="text-sm font-medium sm:text-base">{formatDate(visit.scheduled_date)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 sm:text-sm">Confirmed Date</p>
                <p className="text-sm font-medium sm:text-base">{formatDate(visit.confirmed_date, 'Not confirmed')}</p>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs text-gray-500 sm:text-sm">Notification Number</p>
                  {permissions.canEditNotification && (
                    <EditNotificationButton visitId={visit.id} value={visit.notification_number ?? ''} />
                  )}
                </div>
                <p className="text-sm font-medium sm:text-base">{visit.notification_number ?? '-'}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="mb-2 text-xs text-gray-500 sm:text-sm">Reports ({reports.length})</p>
                <ReportsList
                  reports={reports}
                  noReportReason={visit.no_report_reason}
                  canDelete={permissions.isAdmin}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 sm:pb-4">
            <CardTitle className="text-base sm:text-lg">Assigned Team</CardTitle>
            {permissions.canReassign && (
              <ReassignButton
                visitId={visit.id}
                users={users}
                current={{
                  vendor_coordinator_id: visit.vendor_coordinator_id,
                  maintenance_engineer_id: visit.maintenance_engineer_id,
                  technical_engineer_id: visit.technical_engineer_id,
                }}
              />
            )}
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-4">
            {(
              [
                ['Vendor Coordinator', visit.vendor_coordinator],
                ['Maintenance Engineer', visit.maintenance_engineer],
                ['Technical Engineer', visit.technical_engineer],
              ] as const
            ).map(([label, person]) => (
              <div key={label}>
                <p className="text-xs text-gray-500 sm:text-sm">{label}</p>
                <p className="text-sm font-medium sm:text-base">{person?.full_name ?? '-'}</p>
                <p className="truncate text-xs text-gray-400 sm:text-sm">{person?.email}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <WorkflowActions visit={visit} permissions={permissions} reportCount={reports.length} />

      {/* Recommendations */}
      <RecommendationsSection
        visit={visit}
        recommendations={recommendations}
        permissions={permissions}
        users={users}
      />

      {/* Activity log */}
      <Card>
        <CardHeader className="pb-2 sm:pb-4">
          <CardTitle className="flex items-center text-base sm:text-lg">
            <Clock className="mr-2 h-4 w-4 sm:h-5 sm:w-5" />
            Activity Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activities.length === 0 ? (
            <p className="py-4 text-center text-sm text-gray-500">No activity recorded yet.</p>
          ) : (
            <div className="relative">
              <div className="absolute bottom-0 left-3 top-0 w-0.5 bg-gray-200 sm:left-4" />
              <div className="space-y-3 sm:space-y-4">
                {activities.map((activity, idx) => (
                  <div key={idx} className="relative pl-8 sm:pl-10">
                    <div className="absolute left-1.5 h-3 w-3 rounded-full border-2 border-white bg-primary-500 sm:left-2.5" />
                    <div className="rounded-lg bg-gray-50 p-2 sm:p-3">
                      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
                        <p className="text-sm font-medium text-gray-900">{activity.event}</p>
                        <p className="text-[10px] text-gray-500 sm:text-sm">{formatDateTime(activity.date)}</p>
                      </div>
                      {activity.details && (
                        <p className="mt-1 line-clamp-2 text-xs text-gray-600 sm:text-sm">{activity.details}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
