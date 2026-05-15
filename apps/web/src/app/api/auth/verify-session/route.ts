import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase-admin'

export async function POST(req: NextRequest) {
  try {
    const { sessionCookie } = await req.json() as { sessionCookie: string }
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
    const role = (decoded as Record<string, unknown>)['role'] as string ?? 'staff'
    return NextResponse.json({ uid: decoded.uid, email: decoded.email, role })
  } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }
}
