import type { Metadata } from 'next'
import ReviewClient from './ReviewClient'

export const metadata: Metadata = { title: 'Review Takeoff — Vendy' }

export default async function ReviewPage({
  params,
}: {
  params: Promise<{ project_id: string; job_id: string }>
}) {
  const { project_id, job_id } = await params
  return <ReviewClient projectId={project_id} jobId={job_id} />
}
