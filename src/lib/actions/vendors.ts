'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth, hasRole } from '@/lib/auth';
import { ok, err, type ActionResult, type ImportResult } from '@/lib/action-result';

export interface VendorInput {
  name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
}

export async function saveVendor(id: string | null, input: VendorInput): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  if (!hasRole(profile, 'admin')) return err('Only admins can manage vendors');
  if (!input.name.trim()) return err('Vendor name is required');

  const data = {
    name: input.name.trim(),
    contact_email: input.contact_email.trim() || null,
    contact_phone: input.contact_phone.trim() || null,
    address: input.address.trim() || null,
  };

  const { error } = id
    ? await supabase.from('vendors').update(data).eq('id', id)
    : await supabase.from('vendors').insert(data);
  if (error) return err(error.message);

  revalidatePath('/', 'layout');
  return ok(id ? 'Vendor updated' : 'Vendor created');
}

export async function toggleVendorActive(id: string, isActive: boolean): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  if (!hasRole(profile, 'admin')) return err('Only admins can manage vendors');

  const { error } = await supabase.from('vendors').update({ is_active: isActive }).eq('id', id);
  if (error) return err(error.message);

  revalidatePath('/', 'layout');
  return ok(isActive ? 'Vendor reactivated' : 'Vendor deactivated');
}

/** Bulk import from parsed CSV rows. Only `name` is required. */
export async function importVendors(rows: Record<string, string>[]): Promise<ImportResult> {
  const { supabase, profile } = await requireAuth();
  if (!hasRole(profile, 'admin')) {
    return { ok: false, success: 0, failed: rows.length, errors: ['Only admins can create vendors'] };
  }

  const errors: string[] = [];
  const toInsert = rows.flatMap((row, i) => {
    if (!row.name?.trim()) {
      errors.push(`Row ${i + 2}: Missing vendor name`);
      return [];
    }
    return [
      {
        name: row.name.trim(),
        contact_email: row.contact_email || null,
        contact_phone: row.contact_phone || null,
        address: row.address || null,
      },
    ];
  });

  if (toInsert.length > 0) {
    const { error } = await supabase.from('vendors').insert(toInsert);
    if (error) {
      return { ok: false, success: 0, failed: rows.length, errors: [...errors, error.message] };
    }
  }

  revalidatePath('/', 'layout');
  return { ok: errors.length === 0, success: toInsert.length, failed: errors.length, errors };
}
