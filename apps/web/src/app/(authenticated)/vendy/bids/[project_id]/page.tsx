import ProjectBidsClient from './ProjectBidsClient'

export default async function ProjectBidsPage({ params }: { params: Promise<{ project_id: string }> }) {
  const { project_id } = await params
  return <ProjectBidsClient projectId={project_id} />
}
