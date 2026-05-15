import { NextRequest, NextResponse } from 'next/server'
import type { UserRole } from './types/auth'

const ROUTE_PERMISSIONS: Record<string, UserRole[]> = {
  '/dashboard': ['admin', 'management', 'pm', 'staff', 'vendor'],
  '/vendy': ['admin', 'management', 'pm'],
  '/margo': ['admin', 'management', 'pm'],
  '/admin': ['admin'],
}

function matchRoute(pathname: string): UserRole[] | null {
  for (const [route, roles] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return roles
    }
  }
  return null
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth/') ||
    pathname.startsWith('/api/health') ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next()
  }

  const sessionCookie = req.cookies.get('session')?.value

  if (!sessionCookie) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('callbackUrl', pathname)
    return NextResponse.redirect(loginUrl)
  }

  try {
    const verifyRes = await fetch(new URL('/api/auth/verify-session', req.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionCookie }),
    })

    if (!verifyRes.ok) {
      const loginUrl = new URL('/login', req.url)
      return NextResponse.redirect(loginUrl)
    }

    const { role } = await verifyRes.json() as { role: UserRole }

    const allowedRoles = matchRoute(pathname)
    if (allowedRoles && !allowedRoles.includes(role)) {
      const dashboardUrl = new URL('/dashboard', req.url)
      dashboardUrl.searchParams.set('error', 'unauthorized')
      return NextResponse.redirect(dashboardUrl)
    }

    return NextResponse.next()
  } catch {
    const loginUrl = new URL('/login', req.url)
    return NextResponse.redirect(loginUrl)
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
