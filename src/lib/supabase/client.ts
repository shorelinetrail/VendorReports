import { createBrowserClient } from '@supabase/ssr';
import { Database } from '@/types/database';

// Placeholder values for build time - will be replaced with actual values at runtime
const PLACEHOLDER_URL = 'https://placeholder.supabase.co';
const PLACEHOLDER_KEY = 'placeholder-key';

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || PLACEHOLDER_KEY;

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
