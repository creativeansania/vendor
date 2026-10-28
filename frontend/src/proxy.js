import { NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME, verifyJwtToken } from '@/lib/auth';

export function proxy(request) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value;
  const decoded = token ? verifyJwtToken(token) : null;

  // 1. Authenticated user visiting /login -> redirect straight to dashboard
  if (pathname === '/login') {
    if (decoded) {
      return NextResponse.redirect(new URL('/', request.url));
    }
    if (token && !decoded) {
      // Clear expired/corrupted cookie so /login renders cleanly
      const res = NextResponse.next();
      res.cookies.delete(AUTH_COOKIE_NAME);
      return res;
    }
    return NextResponse.next();
  }

  // 2. Protected app pages (/, /orders/*, /admin/*)
  if (!decoded) {
    const loginUrl = new URL('/login', request.url);
    const res = NextResponse.redirect(loginUrl);
    if (token) {
      res.cookies.delete(AUTH_COOKIE_NAME);
    }
    return res;
  }

  // 3. Role-based server guard for /admin/*
  if (pathname.startsWith('/admin') && decoded.role !== 'master_admin') {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/login', '/orders/:path*', '/admin/:path*']
};

