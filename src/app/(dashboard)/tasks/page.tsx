import { differenceInCalendarDays } from 'date-fns';
import { AlertTriangle, CheckCircle, Clock, ListTodo } from 'lucide-react';
import { requireAuth, hasRole } from '@/lib/auth';
import {
  asDate,
  formatDate,
  isOverdue,
  TASK_TYPE_LABELS,
  type BadgeVariant,
} from '@/lib/labels';
import PageHeader from '@/components/ui/PageHeader';
import StatCard from '@/components/ui/StatCard';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import FilterSelect from '@/components/ui/FilterSelect';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import TaskRowActions from './TaskRowActions';
import ShowAllToggle from './ShowAllToggle';
import type { TaskStatus, TaskType } from '@/types/database';

interface TaskRow {
  id: string;
  task_type: TaskType;
  due_date: string;
  status: TaskStatus;
  visit: {
    id: string;
    routine: { plan_number: string; description: string; vendor: { name: string } | null } | null;
  } | null;
  assigned_to: { full_name: string } | null;
}

const TASK_TYPE_COLORS: Record<TaskType, string> = {
  confirm_visit_date: 'bg-blue-100 text-blue-800',
  upload_report: 'bg-purple-100 text-purple-800',
  create_recommendations: 'bg-green-100 text-green-800',
  review_recommendations: 'bg-yellow-100 text-yellow-800',
  technical_review: 'bg-orange-100 text-orange-800',
  close_visit: 'bg-emerald-100 text-emerald-800',
};

function statusInfo(task: TaskRow): { variant: BadgeVariant; label: string } {
  if (task.status === 'completed') return { variant: 'completed', label: 'Completed' };
  if (task.status === 'cancelled') return { variant: 'cancelled', label: 'Cancelled' };
  if (task.status === 'overdue' || isOverdue(task.due_date)) return { variant: 'overdue', label: 'Overdue' };
  const daysLeft = differenceInCalendarDays(asDate(task.due_date), new Date());
  if (daysLeft === 0) return { variant: 'warning', label: 'Due Today' };
  if (daysLeft <= 3) return { variant: 'warning', label: 'Due Soon' };
  if (task.status === 'in_progress') return { variant: 'in_progress', label: 'In Progress' };
  return { variant: 'pending', label: 'Pending' };
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; scope?: string }>;
}) {
  const { supabase, profile } = await requireAuth();
  const params = await searchParams;

  const isAdmin = hasRole(profile, 'admin');
  const showAll = isAdmin && params.scope === 'all';
  const statusFilter = params.status ?? 'pending';

  let query = supabase
    .from('tasks')
    .select(
      'id, task_type, due_date, status, visit:maintenance_visits(id, routine:maintenance_routines(plan_number, description, vendor:vendors(name))), assigned_to:users!tasks_assigned_to_id_fkey(full_name)',
    )
    .order('due_date', { ascending: true });
  if (!showAll) query = query.eq('assigned_to_id', profile.id);

  const { data } = await query;
  const tasks = (data ?? []) as unknown as TaskRow[];

  const counts = {
    pending: tasks.filter((t) => t.status === 'pending').length,
    inProgress: tasks.filter((t) => t.status === 'in_progress').length,
    overdue: tasks.filter((t) => t.status === 'overdue' || isOverdue(t.due_date, t.status)).length,
    completed: tasks.filter((t) => t.status === 'completed').length,
  };

  const filtered = tasks.filter((t) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'overdue') return t.status === 'overdue' || isOverdue(t.due_date, t.status);
    return t.status === statusFilter;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="My Tasks" description="Workflow steps assigned to you, ordered by due date" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Pending" value={counts.pending} icon={Clock} color="yellow" href="/tasks?status=pending" />
        <StatCard title="In Progress" value={counts.inProgress} icon={Clock} color="blue" href="/tasks?status=in_progress" />
        <StatCard title="Overdue" value={counts.overdue} icon={AlertTriangle} color="red" href="/tasks?status=overdue" />
        <StatCard title="Completed" value={counts.completed} icon={CheckCircle} color="green" href="/tasks?status=completed" />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-4">
            <FilterSelect
              param="status"
              defaultValue="pending"
              className="w-44"
              options={[
                { value: 'all', label: 'All Tasks' },
                { value: 'pending', label: 'Pending' },
                { value: 'in_progress', label: 'In Progress' },
                { value: 'overdue', label: 'Overdue' },
                { value: 'completed', label: 'Completed' },
                { value: 'cancelled', label: 'Cancelled' },
              ]}
            />
            {isAdmin && <ShowAllToggle />}
          </div>
          <p className="text-sm text-gray-500">
            Showing {filtered.length} of {tasks.length} tasks
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title="No tasks found"
              description={
                statusFilter === 'pending'
                  ? 'You have no pending tasks. Try another filter to see past work.'
                  : 'No tasks match this filter.'
              }
            />
          ) : (
            <Table className="border-0">
              <TableHeader>
                <TableRow>
                  <TableHead>Task</TableHead>
                  <TableHead>Plan / Vendor</TableHead>
                  {showAll && <TableHead>Assigned To</TableHead>}
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((task) => {
                  const info = statusInfo(task);
                  return (
                    <TableRow key={task.id}>
                      <TableCell>
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TASK_TYPE_COLORS[task.task_type]}`}>
                          {TASK_TYPE_LABELS[task.task_type]}
                        </span>
                      </TableCell>
                      <TableCell>
                        <p className="font-medium">{task.visit?.routine?.plan_number ?? '-'}</p>
                        <p className="text-xs text-gray-500">{task.visit?.routine?.vendor?.name}</p>
                      </TableCell>
                      {showAll && <TableCell>{task.assigned_to?.full_name ?? '-'}</TableCell>}
                      <TableCell className={info.variant === 'overdue' ? 'font-medium text-red-600' : ''}>
                        {formatDate(task.due_date)}
                      </TableCell>
                      <TableCell>
                        <Badge variant={info.variant}>{info.label}</Badge>
                      </TableCell>
                      <TableCell align="right">
                        {task.visit && <TaskRowActions taskId={task.id} visitId={task.visit.id} status={task.status} />}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
