import type { Metadata } from 'next'
import CostCodeDetailClient from './CostCodeDetailClient'

export const metadata: Metadata = { title: 'Cost Code — Vendy' }

export default async function CostCodeDetailPage({
  params,
}: {
  params: Promise<{ project_id: string; cost_code: string }>
}) {
  const { project_id, cost_code } = await params
  return <CostCodeDetailClient projectId={project_id} costCode={cost_code} />
}
