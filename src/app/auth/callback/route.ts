import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const error_description = searchParams.get('error_description');
  const next = searchParams.get('next') ?? '/dashboard';

  // Handle error from Supabase (e.g., expired link)
  if (error_description) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error_description)}`
    );
  }

  if (code) {
    try {
      const supabase = await createClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        return NextResponse.redirect(`${origin}${next}`);
      }

      console.error('Auth callback error:', error.message);
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent(error.message)}`
      );
    } catch (err) {
      console.error('Auth callback exception:', err);
      return NextResponse.redirect(
        `${origin}/login?error=${encodeURIComponent('Authentication failed. Please try again.')}`
      );
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Could not authenticate user`);
}
