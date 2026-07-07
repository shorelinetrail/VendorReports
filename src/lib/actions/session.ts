'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getAuth, IMPERSONATE_COOKIE } from '@/lib/auth';
import { ok, err, type ActionResult } from '@/lib/action-result';

export async function signOut(): Promise<never> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  (await cookies()).delete(IMPERSONATE_COOKIE);
  redirect('/login');
}

export async function startImpersonation(userId: string): Promise<ActionResult> {
  const { realProfile, supabase } = await getAuth();
  if (realProfile?.role !== 'admin') return err('Only admins can impersonate users');

  const { data: target } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('id', userId)
    .single();
  if (!target) return err('User not found');

  (await cookies()).set(IMPERSONATE_COOKIE, userId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });
  revalidatePath('/', 'layout');
  return ok(`Viewing as ${target.full_name}`);
}

export async function stopImpersonation(): Promise<ActionResult> {
  (await cookies()).delete(IMPERSONATE_COOKIE);
  revalidatePath('/', 'layout');
  return ok('Stopped impersonating');
}
