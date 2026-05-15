import { NextRequest, NextResponse } from 'next/server'
import { adminAuth } from '@/lib/firebase-admin'

const SESSION_DURATION_MS = 5 * 24 * 60 * 60 * 1000 // 5 days

export async function POST(req: NextRequest) {
  try {
    const { idToken } = await req.json() as { idToken: string }

    const decoded = await adminAuth.verifyIdToken(idToken)
    if (!decoded.email?.endsWith('@oakleyhomebuilders.com')) {
      return NextResponse.json({ error: 'Unauthorized domain' }, { status: 403 })
    }

    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_DURATION_MS,
    })

    const response = NextResponse.json({ status: 'ok' })
    response.cookies.set('session', sessionCookie, {
      maxAge: SESSION_DURATION_MS / 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    })

    return response
  } catch {
    return NextResponse.json({ error: 'Failed to create session' }, { status: 401 })
  }
}

export async function DELETE() {
  const response = NextResponse.json({ status: 'ok' })
  response.cookies.set('session', '', {
    maxAge: 0,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })
  return response
}
