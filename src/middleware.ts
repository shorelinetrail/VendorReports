import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// Verifies the session (and refreshes expired tokens) on every request.
// Real authorization lives in Postgres RLS and in the server actions.
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
