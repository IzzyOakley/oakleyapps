import { cookies } from 'next/headers'
import { adminAuth } from '@/lib/firebase-admin'
import type { AuthUser, UserRole } from '@/types/auth'
import DashboardClient from './DashboardClient'

async function getUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies()
  const sessionCookie = cookieStore.get('session')?.value
  if (!sessionCookie) return null
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true)
    return {
      uid: decoded.uid,
      email: decoded.email ?? '',
      name: decoded.name as string ?? decoded.email ?? '',
      photoURL: decoded.picture as string | undefined,
      role: ((decoded as Record<string, unknown>)['role'] as UserRole) ?? 'staff',
    }
  } catch {
    return null
  }
}

export default async function DashboardPage() {
  const user = await getUser()

  return <DashboardClient user={user} />
}
