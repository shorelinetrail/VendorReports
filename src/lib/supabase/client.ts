import { createBrowserClient } from '@supabase/ssr';
import { Database } from '@/types/database';

// Placeholder for build time only
const BUILD_PLACEHOLDER = 'https://placeholder.supabase.co';

export function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || BUILD_PLACEHOLDER;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder';

  // Log warning if using placeholders at runtime (in browser)
  if (typeof window !== 'undefined' && supabaseUrl === BUILD_PLACEHOLDER) {
    console.error('Supabase not configured! Check environment variables.');
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
