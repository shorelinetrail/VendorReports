import type { NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export type CronAuth = { ok: true } | { ok: false; status: number; error: string };

/**
 * Authorize a cron endpoint: allowed for the Vercel cron scheduler, a
 * CRON_SECRET bearer token, or a bearer token belonging to an admin user.
 */
export async function authorizeCron(request: NextRequest): Promise<CronAuth> {
  if (request.headers.get('x-vercel-cron') === '1') return { ok: true };

  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return { ok: true };

  const token = authHeader?.replace('Bearer ', '');
  if (!token) return { ok: false, status: 401, error: 'Unauthorized' };

  const admin = createAdminClient();
  const {
    data: { user },
    error,
  } = await admin.auth.getUser(token);
  if (error || !user) return { ok: false, status: 401, error: 'Unauthorized' };

  const { data: profile } = await admin.from('users').select('role').eq('id', user.id).single();
  if (profile?.role !== 'admin') return { ok: false, status: 403, error: 'Admin access required' };

  return { ok: true };
}
