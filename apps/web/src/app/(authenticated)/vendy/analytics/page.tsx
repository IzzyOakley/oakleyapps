import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { adminAuth } from '@/lib/firebase-admin'
import AnalyticsClient from './AnalyticsClient'

export const metadata: Metadata = { title: 'Analytics — Vendy' }

export default async function AnalyticsPage() {
  const cookieStore = await cookies()
  const session = cookieStore.get('session')?.value
  if (!session) redirect('/login')

  try {
    const decoded = await adminAuth.verifySessionCookie(session, false)
    const role = ((decoded as Record<string, unknown>)['role'] as string) ?? 'staff'
    if (!['admin', 'management'].includes(role)) redirect('/vendy')
  } catch {
    redirect('/login')
  }

  return <AnalyticsClient />
}
