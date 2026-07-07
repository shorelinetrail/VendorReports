'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth, hasRole } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import { ok, err, type ActionResult, type ImportResult } from '@/lib/action-result';
import type { UserRole } from '@/types/database';

const VALID_ROLES: UserRole[] = ['admin', 'vendor_coordinator', 'maintenance_engineer', 'technical_engineer'];

interface NewUser {
  email: string;
  password: string;
  full_name: string;
  role: UserRole;
}

function validateNewUser(input: NewUser): string | null {
  if (!input.email.trim() || !input.full_name.trim() || !input.role) return 'Missing required fields';
  if (!VALID_ROLES.includes(input.role)) return `Invalid role "${input.role}"`;
  if (!input.password || input.password.length < 6) return 'Password must be at least 6 characters';
  return null;
}

/** Create the auth user (auto-confirmed) and its profile row via the service role. */
async function createUserCore(input: NewUser): Promise<ActionResult> {
  const invalid = validateNewUser(input);
  if (invalid) return err(invalid);

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email.trim(),
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: input.full_name.trim(), role: input.role },
  });
  if (error || !data.user) return err(error?.message ?? 'Failed to create user');

  const { error: profileError } = await admin.from('users').insert({
    id: data.user.id,
    email: data.user.email!,
    full_name: input.full_name.trim(),
    role: input.role,
  });
  if (profileError) {
    return err(`User created but profile setup failed: ${profileError.message}`);
  }
  return ok();
}

export async function createUser(input: NewUser): Promise<ActionResult> {
  const { profile } = await requireAuth();
  if (!hasRole(profile, 'admin')) return err('Only admins can create users');

  const result = await createUserCore(input);
  if (!result.ok) return result;

  revalidatePath('/', 'layout');
  return ok('User created');
}

export async function updateUser(
  id: string,
  input: { full_name: string; role: UserRole },
): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  if (!hasRole(profile, 'admin')) return err('Only admins can edit users');
  if (!input.full_name.trim()) return err('Full name is required');
  if (!VALID_ROLES.includes(input.role)) return err('Invalid role');

  const { error } = await supabase
    .from('users')
    .update({ full_name: input.full_name.trim(), role: input.role })
    .eq('id', id);
  if (error) return err(error.message);

  revalidatePath('/', 'layout');
  return ok('User updated');
}

export async function toggleUserActive(id: string, isActive: boolean): Promise<ActionResult> {
  const { supabase, profile, realProfile } = await requireAuth();
  if (!hasRole(profile, 'admin')) return err('Only admins can manage users');
  if (id === realProfile.id && !isActive) return err('You cannot deactivate your own account');

  const { error } = await supabase.from('users').update({ is_active: isActive }).eq('id', id);
  if (error) return err(error.message);

  revalidatePath('/', 'layout');
  return ok(isActive ? 'User reactivated' : 'User deactivated');
}

/** Bulk import from parsed CSV rows: full_name, email, role, password. */
export async function importUsers(rows: Record<string, string>[]): Promise<ImportResult> {
  const { profile } = await requireAuth();
  if (!hasRole(profile, 'admin')) {
    return { ok: false, success: 0, failed: rows.length, errors: ['Only admins can create users'] };
  }

  let success = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const label = `Row ${i + 2}${row.email ? ` (${row.email})` : ''}`;
    const result = await createUserCore({
      email: row.email ?? '',
      password: row.password ?? '',
      full_name: row.full_name ?? '',
      role: row.role as UserRole,
    });
    if (result.ok) {
      success++;
    } else {
      errors.push(`${label}: ${result.error}`);
    }
  }

  revalidatePath('/', 'layout');
  return { ok: errors.length === 0, success, failed: errors.length, errors };
}
