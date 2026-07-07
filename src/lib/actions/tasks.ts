'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth, hasRole } from '@/lib/auth';
import { ok, err, type ActionResult } from '@/lib/action-result';

export async function startTask(taskId: string): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  const { data: task } = await supabase.from('tasks').select('id, assigned_to_id, status').eq('id', taskId).single();
  if (!task) return err('Task not found');
  if (task.assigned_to_id !== profile.id && !hasRole(profile, 'admin')) return err('Not your task');
  if (task.status !== 'pending' && task.status !== 'overdue') return err('Task cannot be started');

  const { error } = await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', taskId);
  if (error) return err(error.message);

  revalidatePath('/', 'layout');
  return ok('Task started');
}

export async function completeTask(taskId: string): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  const { data: task } = await supabase.from('tasks').select('id, assigned_to_id, status').eq('id', taskId).single();
  if (!task) return err('Task not found');
  if (task.assigned_to_id !== profile.id && !hasRole(profile, 'admin')) return err('Not your task');
  if (task.status === 'completed' || task.status === 'cancelled') return err('Task is already closed');

  const { error } = await supabase
    .from('tasks')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', taskId);
  if (error) return err(error.message);

  revalidatePath('/', 'layout');
  return ok('Task completed');
}
