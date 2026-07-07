import { createClient } from '@supabase/supabase-js';

// Service-role client. Bypasses RLS — only use after verifying the caller
// is authorized (admin session or cron secret). Untyped: the hand-written
// Database interface doesn't carry the relationship metadata supabase-js
// needs for schema generics (same as the cookie-bound clients).
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
