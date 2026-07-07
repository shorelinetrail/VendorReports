import Link from 'next/link';
import { addDays, addMonths, endOfMonth, format, startOfMonth, subMonths } from 'date-fns';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckSquare,
  ClipboardList,
  FileText,
  ListTodo,
  TrendingUp,
} from 'lucide-react';
import { requireAuth } from '@/lib/auth';
import {
  formatDate,
  isOverdue,
  TASK_TYPE_LABELS,
  TASK_STATUS_LABELS,
  VISIT_STATUS_LABELS,
  VISIT_STATUS_VARIANTS,
  todayISO,
} from '@/lib/labels';
import PageHeader from '@/components/ui/PageHeader';
import StatCard from '@/components/ui/StatCard';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import CalendarSection, { type CalendarVisitEvent } from './CalendarSection';
import type { TaskStatus, TaskType, VisitStatus } from '@/types/database';

interface VisitRow {
  id: string;
  scheduled_date: string;
  status: VisitStatus;
  routine: { plan_number: string; description: string; vendor: { name: string } | null } | null;
}

interface TaskRow {
  id: string;
  task_type: TaskType;
  due_date: string;
  status: TaskStatus;
  visit_id: string;
  visit: { routine: { plan_number: string; vendor: { name: string } | null } | null } | null;
}

export default async function DashboardPage() {
  const { supabase, profile } = await requireAuth();

  const now = new Date();
  const today = todayISO();
  const monthStart = startOfMonth(now).toISOString();
  const monthEnd = endOfMonth(now).toISOString();
  const calendarStart = format(subMonths(startOfMonth(now), 1), 'yyyy-MM-dd');
  const calendarEnd = format(addMonths(endOfMonth(now), 1), 'yyyy-MM-dd');

  const [routinesRes, activeVisitsRes, myTasksRes, openRecsRes, completedRes, upcomingRes, pendingTasksRes, calendarRes] =
    await Promise.all([
      supabase.from('maintenance_routines').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase
        .from('maintenance_visits')
        .select('id', { count: 'exact', head: true })
        .not('status', 'in', '(completed,cancelled)'),
      supabase
        .from('tasks')
        .select('id, status, due_date')
        .eq('assigned_to_id', profile.id)
        .in('status', ['pending', 'in_progress', 'overdue']),
      supabase.from('recommendations').select('id', { count: 'exact', head: true }).eq('status', 'open'),
      supabase
        .from('maintenance_visits')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'completed')
        .gte('completed_at', monthStart)
        .lte('completed_at', monthEnd),
      supabase
        .from('maintenance_visits')
        .select('id, scheduled_date, status, routine:maintenance_routines(plan_number, description, vendor:vendors(name))')
        .gte('scheduled_date', today)
        .lte('scheduled_date', format(addDays(now, 30), 'yyyy-MM-dd'))
        .not('status', 'in', '(completed,cancelled)')
        .order('scheduled_date', { ascending: true })
        .limit(5),
      supabase
        .from('tasks')
        .select('id, task_type, due_date, status, visit_id, visit:maintenance_visits(routine:maintenance_routines(plan_number, vendor:vendors(name)))')
        .eq('assigned_to_id', profile.id)
        .in('status', ['pending', 'in_progress', 'overdue'])
        .order('due_date', { ascending: true })
        .limit(5),
      supabase
        .from('maintenance_visits')
        .select('id, scheduled_date, status, routine:maintenance_routines(plan_number, description, vendor:vendors(name))')
        .gte('scheduled_date', calendarStart)
        .lte('scheduled_date', calendarEnd)
        .order('scheduled_date', { ascending: true }),
    ]);

  const myOpenTasks = myTasksRes.data ?? [];
  const overdueCount = myOpenTasks.filter((t) => t.status === 'overdue' || isOverdue(t.due_date, t.status)).length;

  const upcomingVisits = (upcomingRes.data ?? []) as unknown as VisitRow[];
  const pendingTasks = (pendingTasksRes.data ?? []) as unknown as TaskRow[];
  const calendarEvents: CalendarVisitEvent[] = ((calendarRes.data ?? []) as unknown as VisitRow[]).map((v) => ({
    id: v.id,
    date: v.scheduled_date,
    title: v.routine?.plan_number ?? 'Visit',
    status: v.status,
    vendorName: v.routine?.vendor?.name ?? '',
    description: v.routine?.description ?? '',
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description={`Welcome back, ${profile.full_name}`} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard title="Active Routines" value={routinesRes.count ?? 0} icon={CalendarIcon} color="blue" href="/routines" />
        <StatCard title="Active Visits" value={activeVisitsRes.count ?? 0} icon={ClipboardList} color="green" href="/visits" />
        <StatCard title="My Pending Tasks" value={myOpenTasks.length} icon={CheckSquare} color="yellow" href="/tasks" />
        <StatCard title="Overdue Tasks" value={overdueCount} icon={AlertTriangle} color="red" href="/tasks?status=overdue" />
        <StatCard title="Open Recommendations" value={openRecsRes.count ?? 0} icon={FileText} color="purple" href="/recommendations" />
        <StatCard title="Completed This Month" value={completedRes.count ?? 0} icon={TrendingUp} color="teal" href="/visits?status=completed" />
      </div>

      <CalendarSection events={calendarEvents} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 sm:gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming Visits (Next 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingVisits.length === 0 ? (
              <EmptyState icon={CalendarIcon} title="No upcoming visits" description="Visits scheduled in the next 30 days will appear here." />
            ) : (
              <div className="space-y-2">
                {upcomingVisits.map((visit) => (
                  <Link
                    key={visit.id}
                    href={`/visits/${visit.id}`}
                    className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-3 transition-colors hover:bg-gray-50"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{visit.routine?.plan_number}</p>
                      <p className="truncate text-xs text-gray-500">{visit.routine?.vendor?.name}</p>
                      <p className="text-xs text-gray-400">{formatDate(visit.scheduled_date)}</p>
                    </div>
                    <Badge variant={VISIT_STATUS_VARIANTS[visit.status]} size="sm">
                      {VISIT_STATUS_LABELS[visit.status]}
                    </Badge>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">My Pending Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            {pendingTasks.length === 0 ? (
              <EmptyState icon={ListTodo} title="No pending tasks" description="You're all caught up." />
            ) : (
              <div className="space-y-2">
                {pendingTasks.map((task) => {
                  const overdue = task.status === 'overdue' || isOverdue(task.due_date, task.status);
                  return (
                    <Link
                      key={task.id}
                      href={`/visits/${task.visit_id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 p-3 transition-colors hover:bg-gray-50"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{TASK_TYPE_LABELS[task.task_type]}</p>
                        <p className="truncate text-xs text-gray-500">
                          {task.visit?.routine?.plan_number}
                          {task.visit?.routine?.vendor?.name ? ` — ${task.visit.routine.vendor.name}` : ''}
                        </p>
                        <p className={`text-xs ${overdue ? 'font-medium text-red-600' : 'text-gray-400'}`}>
                          Due {formatDate(task.due_date)}
                        </p>
                      </div>
                      <Badge variant={overdue ? 'overdue' : 'pending'} size="sm">
                        {overdue ? 'Overdue' : TASK_STATUS_LABELS[task.status]}
                      </Badge>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
