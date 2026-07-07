import { ReactNode } from 'react';
import { requireAuth, hasRole } from '@/lib/auth';
import { isOverdue, TASK_TYPE_LABELS } from '@/lib/labels';
import { ToastProvider } from '@/components/ui/Toaster';
import AppShell, { type NotificationItem } from '@/components/layout/AppShell';
import type { TaskType, User } from '@/types/database';

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  const { supabase, profile, realProfile, isImpersonating } = await requireAuth();

  const isRealAdmin = realProfile.role === 'admin';
  const canSeeReviewQueue = hasRole(profile, ['admin', 'technical_engineer']);

  const [tasksRes, recsRes, usersRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, task_type, due_date, status, visit:maintenance_visits(id, routine:maintenance_routines(plan_number))')
      .eq('assigned_to_id', profile.id)
      .in('status', ['pending', 'in_progress', 'overdue'])
      .order('due_date', { ascending: true })
      .limit(5),
    canSeeReviewQueue
      ? supabase
          .from('recommendations')
          .select('id, description, due_date, status')
          .eq('status', 'in_review')
          .order('created_at', { ascending: false })
          .limit(3)
      : Promise.resolve({ data: [] }),
    // Users list powers the admin "view as" impersonation menu.
    isRealAdmin
      ? supabase.from('users').select('*').eq('is_active', true).order('full_name')
      : Promise.resolve({ data: [] }),
  ]);

  const notifications: NotificationItem[] = [
    ...(tasksRes.data ?? []).map((task) => {
      const visit = task.visit as unknown as { id: string; routine: { plan_number: string } | null } | null;
      return {
        id: `task-${task.id}`,
        kind: 'task' as const,
        title: TASK_TYPE_LABELS[task.task_type as TaskType] ?? task.task_type,
        description: `Plan: ${visit?.routine?.plan_number ?? 'Unknown'}`,
        link: visit ? `/visits/${visit.id}` : '/tasks',
        dueDate: task.due_date,
        isOverdue: task.status === 'overdue' || isOverdue(task.due_date, task.status),
      };
    }),
    ...((recsRes.data ?? []) as { id: string; description: string; due_date: string | null; status: string }[]).map(
      (rec) => ({
        id: `rec-${rec.id}`,
        kind: 'recommendation' as const,
        title: 'Review Needed',
        description: rec.description.length > 50 ? `${rec.description.slice(0, 50)}…` : rec.description,
        link: '/recommendations',
        dueDate: rec.due_date,
        isOverdue: isOverdue(rec.due_date, rec.status),
      }),
    ),
  ];

  return (
    <ToastProvider>
      <AppShell
        profile={profile}
        realProfile={realProfile}
        isImpersonating={isImpersonating}
        impersonationUsers={(usersRes.data ?? []) as User[]}
        notifications={notifications}
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
