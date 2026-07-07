import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { SupabaseClient, User as SupabaseUser } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import type { User, UserRole } from '@/types/database';

export const IMPERSONATE_COOKIE = 'vr-impersonate';

export interface AuthContext {
  supabase: SupabaseClient;
  /** Profile the app acts as — the impersonated user when impersonation is active. */
  profile: User | null;
  /** The genuinely logged-in user's profile. Authorization that must not be
   *  spoofable (impersonation itself, settings access) checks this one. */
  realProfile: User | null;
  isImpersonating: boolean;
}

function fallbackProfile(user: SupabaseUser): User {
  // Synthesized from auth metadata so the app still works if the users row
  // is momentarily missing (e.g. right after account creation).
  const meta = user.user_metadata ?? {};
  return {
    id: user.id,
    email: user.email ?? '',
    full_name: meta.full_name || meta.name || user.email?.split('@')[0] || 'User',
    role: (meta.role as UserRole) || 'vendor_coordinator',
    is_active: true,
    created_at: user.created_at,
    updated_at: user.updated_at || user.created_at,
  };
}

/** Resolve the current session once per request (React cache). */
export const getAuth = cache(async (): Promise<AuthContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, profile: null, realProfile: null, isImpersonating: false };
  }

  const { data } = await supabase.from('users').select('*').eq('id', user.id).single();
  const realProfile = (data as User | null) ?? fallbackProfile(user);

  let profile = realProfile;
  let isImpersonating = false;

  if (realProfile.role === 'admin') {
    const targetId = (await cookies()).get(IMPERSONATE_COOKIE)?.value;
    if (targetId && targetId !== realProfile.id) {
      const { data: target } = await supabase.from('users').select('*').eq('id', targetId).single();
      if (target) {
        profile = target as User;
        isImpersonating = true;
      }
    }
  }

  return { supabase, profile, realProfile, isImpersonating };
});

/** Like getAuth, but redirects to /login when unauthenticated. */
export async function requireAuth(): Promise<AuthContext & { profile: User; realProfile: User }> {
  const ctx = await getAuth();
  if (!ctx.profile || !ctx.realProfile) redirect('/login');
  return ctx as AuthContext & { profile: User; realProfile: User };
}

export function hasRole(profile: User | null, roles: UserRole | UserRole[]): boolean {
  if (!profile) return false;
  return (Array.isArray(roles) ? roles : [roles]).includes(profile.role);
}
