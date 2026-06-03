import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { adminAuth } from '@/lib/firebase-admin'
import CostCodeDetailClient from './CostCodeDetailClient'

export const metadata: Metadata = { title: 'Cost Code — Vendy' }

export default async function CostCodeDetailPage({
  params,
}: {
  params: Promise<{ project_id: string; cost_code: string }>
}) {
  const { project_id, cost_code } = await params

  const cookieStore = await cookies()
  const session = cookieStore.get('session')?.value
  if (!session) redirect('/login')

  let role = 'staff'
  try {
    const decoded = await adminAuth.verifySessionCookie(session, false)
    role = ((decoded as Record<string, unknown>)['role'] as string) ?? 'staff'
  } catch {
    redirect('/login')
  }

  return <CostCodeDetailClient projectId={project_id} costCode={cost_code} role={role} />
}
