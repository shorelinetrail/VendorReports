'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ok, err, type ActionResult } from '@/lib/action-result';
import { DEADLINE_DEFAULTS, DEADLINE_META, type DeadlineKey } from '@/lib/config';
import { generateVisits, type GenerateResult } from '@/lib/workflow';

// Settings are gated on the REAL profile so impersonation can't change
// (or appear to change) system configuration.

export async function saveDeadlines(values: Record<DeadlineKey, string>): Promise<ActionResult> {
  const { supabase, realProfile } = await requireAuth();
  if (realProfile.role !== 'admin') return err('Only admins can change settings');

  for (const key of Object.keys(DEADLINE_DEFAULTS) as DeadlineKey[]) {
    const value = (values[key] ?? '').trim();
    const num = Number(value);
    if (!/^\d+$/.test(value) || !Number.isInteger(num) || num < 1 || num > 365) {
      return err(`${DEADLINE_META[key].label} must be a whole number between 1 and 365`);
    }
  }

  for (const key of Object.keys(DEADLINE_DEFAULTS) as DeadlineKey[]) {
    const { error } = await supabase
      .from('system_config')
      .upsert(
        { config_key: key, config_value: values[key].trim(), description: DEADLINE_META[key].description },
        { onConflict: 'config_key' },
      );
    if (error) return err(error.message);
  }

  revalidatePath('/', 'layout');
  return ok('Settings saved');
}

export async function triggerVisitGeneration(): Promise<
  ({ ok: true } & GenerateResult) | { ok: false; error: string }
> {
  const { realProfile } = await requireAuth();
  if (realProfile.role !== 'admin') return { ok: false, error: 'Only admins can generate visits' };

  try {
    const result = await generateVisits(createAdminClient());
    revalidatePath('/', 'layout');
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed to generate visits' };
  }
}
