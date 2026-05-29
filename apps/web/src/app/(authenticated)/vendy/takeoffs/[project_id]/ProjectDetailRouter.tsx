'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { getV2Project } from '@/lib/vendy/takeoffs-v2-api'
import type { V2ProjectDetail } from '@/lib/vendy/types'
import ProjectDetailV2Client from './ProjectDetailV2Client'
import ProjectDetailClient from './ProjectDetailClient'

type RouterState = 'loading' | 'v2' | 'v1'

export default function ProjectDetailRouter({ projectId }: { projectId: string }) {
  const [state, setState] = useState<RouterState>('loading')
  const [v2Project, setV2Project] = useState<V2ProjectDetail | null>(null)

  useEffect(() => {
    getV2Project(projectId)
      .then(data => {
        setV2Project(data)
        setState('v2')
      })
      .catch(() => {
        // Any error (404, network) → fall back to v1
        setState('v1')
      })
  }, [projectId])

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (state === 'v2' && v2Project) {
    return (
      <ProjectDetailV2Client
        initialProject={v2Project}
        projectId={projectId}
      />
    )
  }

  return <ProjectDetailClient projectId={projectId} />
}
