'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lock, Clock, FileText, Plus, Search, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react'
import { getProjects, createProject } from '@/lib/vendy/api'
import type { ProjectSummary } from '@/lib/vendy/types'

export default function TakeoffHubClient() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [serviceOffline, setServiceOffline] = useState(false)
  const [search, setSearch] = useState('')
  const [showAddPanel, setShowAddPanel] = useState(false)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  useEffect(() => {
    getProjects()
      .then(data => { setProjects(data); setServiceOffline(false) })
      .catch(() => setServiceOffline(true))
      .finally(() => setLoading(false))
  }, [])

  const filtered = projects.filter(p =>
    p.job_name.toLowerCase().includes(search.toLowerCase()) ||
    p.address.toLowerCase().includes(search.toLowerCase())
  )

  const approved = filtered.filter(p => p.takeoff_status === 'approved')
  const awaiting = filtered.filter(p => p.takeoff_status === 'needs_approval')
  const notStarted = filtered.filter(p => p.takeoff_status === 'none' || p.takeoff_status === 'processing')

  function toggleSection(id: string) {
    setCollapsed(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function handleProjectClick(p: ProjectSummary) {
    if (p.takeoff_status === 'needs_approval' && p.takeoff_job_id) {
      router.push(`/vendy/takeoffs/${p.project_id}/review/${p.takeoff_job_id}`)
    } else {
      router.push(`/vendy/takeoffs/${p.project_id}`)
    }
  }

  return (
    <div className="animate-in fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-8 gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Takeoffs</h1>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="bg-surface border border-border text-text-primary text-sm rounded-lg pl-9 pr-4 h-9 focus:outline-none focus:border-primary transition-colors w-56"
            />
          </div>
          <button
            onClick={() => setShowAddPanel(true)}
            className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover active:scale-95 transition-all duration-150"
          >
            <Plus size={15} />
            Add Project
          </button>
        </div>
      </div>

      {serviceOffline && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 bg-warning/10 border border-warning/30 rounded-xl text-warning text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          <span>Takeoff agent is offline — project data may be unavailable. Start the service and refresh.</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 bg-surface-raised rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-8">
          <HubSection
            label="Approved & Locked"
            count={approved.length}
            collapsed={collapsed['approved']}
            onToggle={() => toggleSection('approved')}
            countColor="text-success"
          >
            {approved.map(p => (
              <ProjectCard key={p.project_id} onClick={() => handleProjectClick(p)}>
                <Lock size={18} className="text-success shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{p.job_name}</p>
                  <p className="text-xs text-text-muted truncate">{p.address}</p>
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-success/15 text-success shrink-0">
                  Approved
                </span>
              </ProjectCard>
            ))}
            {approved.length === 0 && <EmptyRow message="No approved takeoffs yet" />}
          </HubSection>

          <HubSection
            label="Awaiting Approval"
            count={awaiting.length}
            collapsed={collapsed['awaiting']}
            onToggle={() => toggleSection('awaiting')}
            countColor="text-warning"
          >
            {awaiting.map(p => (
              <ProjectCard key={p.project_id} onClick={() => handleProjectClick(p)}>
                <Clock size={18} className="text-warning shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{p.job_name}</p>
                  <p className="text-xs text-text-muted truncate">{p.address}</p>
                </div>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning/15 text-warning shrink-0">
                  Needs Review
                </span>
              </ProjectCard>
            ))}
            {awaiting.length === 0 && <EmptyRow message="No takeoffs awaiting review" />}
          </HubSection>

          <HubSection
            label="Not Started"
            count={notStarted.length}
            collapsed={collapsed['notstarted']}
            onToggle={() => toggleSection('notstarted')}
            countColor="text-slate-400"
          >
            {notStarted.map(p => (
              <ProjectCard key={p.project_id} onClick={() => handleProjectClick(p)}>
                <FileText size={18} className="text-text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-text-primary truncate">{p.job_name}</p>
                  <p className="text-xs text-text-muted truncate">{p.address}</p>
                </div>
                {p.takeoff_status === 'processing' ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/15 text-primary shrink-0">
                    Processing
                  </span>
                ) : !p.has_blueprint ? (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/15 text-slate-400 shrink-0">
                    No Blueprint
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/15 text-slate-400 shrink-0">
                    No Takeoff
                  </span>
                )}
              </ProjectCard>
            ))}
            {notStarted.length === 0 && <EmptyRow message="All projects have takeoffs" />}
          </HubSection>
        </div>
      )}

      {showAddPanel && (
        <AddProjectSlideOver
          onClose={() => setShowAddPanel(false)}
          onCreated={(projectId) => {
            setShowAddPanel(false)
            router.push(`/vendy/takeoffs/${projectId}`)
          }}
        />
      )}
    </div>
  )
}

function HubSection({ label, count, collapsed, onToggle, countColor, children }: {
  label: string
  count: number
  collapsed?: boolean
  onToggle: () => void
  countColor: string
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 mb-3 group w-full text-left"
      >
        {collapsed ? <ChevronRight size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
        <span className="text-xs font-medium uppercase tracking-widest text-text-muted">{label}</span>
        <span className={`text-xs font-semibold ${countColor}`}>{count}</span>
      </button>
      {!collapsed && (
        <div className="space-y-2">{children}</div>
      )}
    </div>
  )
}

function ProjectCard({ onClick, children }: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-4 bg-surface border border-border rounded-xl hover:border-border-bright hover:bg-surface-raised transition-all duration-150 text-left"
    >
      {children}
    </button>
  )
}

function EmptyRow({ message }: { message: string }) {
  return (
    <div className="px-5 py-4 text-sm text-text-muted italic">{message}</div>
  )
}

function AddProjectSlideOver({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (projectId: string) => void
}) {
  const [jobName, setJobName] = useState('')
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!jobName.trim() || !address.trim()) return
    setLoading(true)
    setError(null)
    try {
      const { project_id } = await createProject(jobName.trim(), address.trim())
      onCreated(project_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-surface border-l border-border z-50 flex flex-col animate-in fade-in duration-150">
        <div className="px-6 py-5 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">Add Project</h2>
          <p className="text-sm text-text-secondary mt-1">Create a new project and upload blueprints.</p>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col px-6 py-6 gap-5">
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-text-muted block mb-1.5">Project Name</label>
            <input
              value={jobName}
              onChange={e => setJobName(e.target.value)}
              placeholder="502 Wakeman - Halpin"
              className="w-full bg-surface-raised border border-border text-text-primary text-sm rounded-lg px-3 h-10 focus:outline-none focus:border-primary transition-colors"
              required
            />
          </div>
          <div>
            <label className="text-xs font-medium uppercase tracking-wider text-text-muted block mb-1.5">Address</label>
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="502 Markman Ave, Wheaton, IL"
              className="w-full bg-surface-raised border border-border text-text-primary text-sm rounded-lg px-3 h-10 focus:outline-none focus:border-primary transition-colors"
              required
            />
          </div>
          {error && <p className="text-sm text-error">{error}</p>}
          <div className="mt-auto flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 h-10 rounded-lg border border-border text-text-secondary text-sm hover:border-border-bright transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 h-10 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}
