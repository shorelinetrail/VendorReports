'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth, hasRole } from '@/lib/auth';
import { ok, err, type ActionResult, type ImportResult } from '@/lib/action-result';

export interface RoutineInput {
  plan_number: string;
  description: string;
  vendor_id: string;
  interval_months: number;
  start_date: string;
  call_horizon_months: number;
  vendor_coordinator_id: string;
  maintenance_engineer_id: string;
  technical_engineer_id: string;
  is_active: boolean;
  requires_technical_review: boolean;
}

function validate(input: RoutineInput): string | null {
  if (!input.plan_number.trim()) return 'Plan number is required';
  if (!input.description.trim()) return 'Description is required';
  if (!input.vendor_id) return 'Select a vendor';
  if (!Number.isInteger(input.interval_months) || input.interval_months < 1) {
    return 'Interval must be at least 1 month';
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.start_date)) return 'Enter a valid start date';
  if (!Number.isInteger(input.call_horizon_months) || input.call_horizon_months < 0) {
    return 'Call horizon cannot be negative';
  }
  if (!input.vendor_coordinator_id || !input.maintenance_engineer_id || !input.technical_engineer_id) {
    return 'Assign all three team members';
  }
  return null;
}

export async function saveRoutine(id: string | null, input: RoutineInput): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  if (!hasRole(profile, ['admin', 'vendor_coordinator'])) return err('Not allowed');

  const invalid = validate(input);
  if (invalid) return err(invalid);

  const { error } = id
    ? await supabase.from('maintenance_routines').update(input).eq('id', id)
    : await supabase.from('maintenance_routines').insert(input);
  if (error) return err(error.message);

  revalidatePath('/', 'layout');
  return ok(id ? 'Routine updated' : 'Routine created');
}

export async function toggleRoutineActive(id: string, isActive: boolean): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  if (!hasRole(profile, ['admin', 'vendor_coordinator'])) return err('Not allowed');

  const { error } = await supabase
    .from('maintenance_routines')
    .update({ is_active: isActive })
    .eq('id', id);
  if (error) return err(error.message);

  revalidatePath('/', 'layout');
  return ok(isActive ? 'Routine reactivated' : 'Routine archived');
}

/** Bulk import from parsed CSV rows. Resolves vendor names and user emails server-side. */
export async function importRoutines(rows: Record<string, string>[]): Promise<ImportResult> {
  const { supabase, profile } = await requireAuth();
  if (!hasRole(profile, ['admin', 'vendor_coordinator'])) {
    return { ok: false, success: 0, failed: rows.length, errors: ['Not allowed'] };
  }

  const [{ data: vendors }, { data: users }] = await Promise.all([
    supabase.from('vendors').select('id, name'),
    supabase.from('users').select('id, email'),
  ]);
  const vendorByName = new Map((vendors ?? []).map((v) => [v.name.toLowerCase(), v.id]));
  const userByEmail = new Map((users ?? []).map((u) => [u.email?.toLowerCase(), u.id]));

  let success = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `Row ${i + 2}`; // +2: 1-based plus header row

    const vendorId = vendorByName.get(row.vendor_name?.toLowerCase() ?? '');
    if (!vendorId) {
      errors.push(`${label}: Vendor "${row.vendor_name}" not found`);
      continue;
    }
    const coordinator = userByEmail.get(row.vendor_coordinator_email?.toLowerCase() ?? '');
    if (!coordinator) {
      errors.push(`${label}: Vendor coordinator "${row.vendor_coordinator_email}" not found`);
      continue;
    }
    const maintEngineer = userByEmail.get(row.maintenance_engineer_email?.toLowerCase() ?? '');
    if (!maintEngineer) {
      errors.push(`${label}: Maintenance engineer "${row.maintenance_engineer_email}" not found`);
      continue;
    }
    const techEngineer = userByEmail.get(row.technical_engineer_email?.toLowerCase() ?? '');
    if (!techEngineer) {
      errors.push(`${label}: Technical engineer "${row.technical_engineer_email}" not found`);
      continue;
    }

    const { error } = await supabase.from('maintenance_routines').insert({
      plan_number: row.plan_number,
      description: row.description,
      vendor_id: vendorId,
      interval_months: parseInt(row.interval_months, 10) || 12,
      start_date: row.start_date,
      call_horizon_months: parseInt(row.call_horizon_months, 10) || 1,
      vendor_coordinator_id: coordinator,
      maintenance_engineer_id: maintEngineer,
      technical_engineer_id: techEngineer,
      is_active: row.is_active?.toLowerCase() !== 'false',
      requires_technical_review: row.requires_technical_review?.toLowerCase() !== 'false',
    });
    if (error) {
      errors.push(`${label}: ${error.message}`);
    } else {
      success++;
    }
  }

  revalidatePath('/', 'layout');
  return { ok: errors.length === 0, success, failed: errors.length, errors };
}
