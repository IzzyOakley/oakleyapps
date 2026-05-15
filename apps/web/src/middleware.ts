import { NextRequest, NextResponse } from 'next/server'

// Middleware runs in the Edge Runtime and cannot use firebase-admin or make
// loopback HTTP calls to Cloud Run reliably. It performs a lightweight
// presence-check on the session cookie only.
//
// Full JWT verification + role enforcement happens in:
//   - /api/auth/verify-session  (called by server components / API routes)
//   - Individual page layouts    (redirect to /dashboard with error if wrong role)

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always allow public paths
  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  // Redirect to login if no session cookie present
  const sessionCookie = req.cookies.get('session')?.value
  if (!sessionCookie) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
