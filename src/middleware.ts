import { type NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  // Simple middleware that checks for auth cookie presence
  // Full auth verification happens client-side in AuthContext
  const authCookie = request.cookies.get('sb-access-token') ||
                     request.cookies.getAll().find(c => c.name.includes('auth-token'));

  const publicRoutes = ['/login', '/signup', '/auth/callback', '/'];
  const isPublicRoute = publicRoutes.includes(request.nextUrl.pathname) ||
                        request.nextUrl.pathname.startsWith('/auth/');

  // If no auth cookie and trying to access protected route, redirect to login
  if (!authCookie && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
