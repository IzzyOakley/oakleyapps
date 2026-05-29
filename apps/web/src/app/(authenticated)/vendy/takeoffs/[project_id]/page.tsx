import type { Metadata } from 'next'
import ProjectDetailRouter from './ProjectDetailRouter'

export const metadata: Metadata = { title: 'Project — Vendy' }

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ project_id: string }>
}) {
  const { project_id } = await params
  return <ProjectDetailRouter projectId={project_id} />
}
