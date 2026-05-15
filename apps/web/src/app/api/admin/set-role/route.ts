import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase-admin'
import type { UserRole } from '@/types/auth'

const VALID_ROLES: UserRole[] = ['admin', 'management', 'pm', 'staff', 'vendor']

export async function POST(req: NextRequest) {
  try {
    const sessionCookie = req.cookies.get('session')?.value
    if (!sessionCookie) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const caller = await adminAuth.verifySessionCookie(sessionCookie, true)
    const callerRole = (caller as Record<string, unknown>)['role'] as string
    if (callerRole !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { uid, role } = await req.json() as { uid: string; role: UserRole }

    if (!VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }

    await adminAuth.setCustomUserClaims(uid, { role })

    return NextResponse.json({ status: 'ok', uid, role })
  } catch {
    return NextResponse.json({ error: 'Failed to update role' }, { status: 500 })
  }
}
