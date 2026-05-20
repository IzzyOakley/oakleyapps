'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Lock, Clock, FileText, Plus, Search,
  ChevronRight, AlertTriangle, CheckCircle,
} from 'lucide-react'
import { getProjects, createProject } from '@/lib/vendy/api'
import type { ProjectSummary } from '@/lib/vendy/types'

function formatDate(iso: string | null | undefined) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function TakeoffHubClient() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [serviceOffline, setServiceOffline] = useState(false)
  const [search, setSearch] = useState('')
  const [showAddPanel, setShowAddPanel] = useState(false)

  useEffect(() => {
    getProjects()
      .then(data => { setProjects(data); setServiceOffline(false) })
      .catch(() => setServiceOffline(true))
      .finally(() => setLoading(false))
  }, [])

  const filtered = projects.filter(p =>
    p.job_name.toLowerCase().includes(search.toLowerCase()) ||
    p.address.toLowerCase().includes(search.toLowerCase()),
  )

  const underReview = filtered.filter(p => p.takeoff_status === 'needs_approval')
  const approved = filtered.filter(p => p.takeoff_status === 'approved')
  const notStarted = filtered.filter(p => p.takeoff_status === 'none' || p.takeoff_status === 'processing')

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
        <div>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Takeoffs</h1>
          <p className="text-sm text-text-muted mt-1">
            Upload blueprints, extract quantities, and approve for bid generation.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search projects…"
              className="bg-surface border border-border text-text-primary text-sm rounded-lg pl-9 pr-4 h-9 focus:outline-none focus:border-primary transition-colors w-52"
            />
          </div>
          <button
            onClick={() => setShowAddPanel(true)}
            className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover active:scale-95 transition-all duration-150"
          >
            <Plus size={15} />
            New Project
          </button>
        </div>
      </div>

      {serviceOffline && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 bg-warning-bg border border-warning/30 rounded-xl text-warning text-sm">
          <AlertTriangle size={16} className="shrink-0" />
          <span>Takeoff agent is offline — start the service and refresh.</span>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-surface rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-10">

          {/* ── Under Review ── */}
          {underReview.length > 0 && (
            <TakeoffSection
              title="Under Review"
              count={underReview.length}
              dotColor="bg-warning"
              textColor="text-warning"
            >
              {underReview.map(p => (
                <ProjectCard
                  key={p.project_id}
                  onClick={() => handleProjectClick(p)}
                  icon={<Clock size={16} className="text-warning" />}
                  iconBg="bg-warning/10"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{p.job_name}</p>
                    <p className="text-xs text-text-muted truncate mt-0.5">
                      {p.address || 'Ready for PM review and approval'}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-warning shrink-0">Review</span>
                  <ChevronRight size={15} className="text-text-muted shrink-0" />
                </ProjectCard>
              ))}
            </TakeoffSection>
          )}

          {/* ── Approved & Locked ── */}
          {approved.length > 0 && (
            <TakeoffSection
              title="Approved & Locked"
              count={approved.length}
              dotColor="bg-success"
              textColor="text-success"
            >
              {approved.map(p => (
                <ProjectCard
                  key={p.project_id}
                  onClick={() => handleProjectClick(p)}
                  icon={<Lock size={16} className="text-success" />}
                  iconBg="bg-success/10"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-text-primary truncate">{p.job_name}</p>
                    <p className="text-xs text-text-muted truncate mt-0.5">
                      {p.address || 'Locked — ready for bid generation'}
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-1 shrink-0">
                    <CheckCircle size={12} className="text-success" />
                    <span className="text-xs text-success font-medium">Locked</span>
                  </div>
                  <ChevronRight size={15} className="text-text-muted shrink-0" />
                </ProjectCard>
              ))}
            </TakeoffSection>
          )}

          {/* ── Work on New Project ── */}
          <TakeoffSection
            title="Work on New Project"
            count={notStarted.length}
            dotColor="bg-text-muted"
            textColor="text-text-muted"
          >
            {notStarted.map(p => (
              <ProjectCard
                key={p.project_id}
                onClick={() => handleProjectClick(p)}
                icon={<FileText size={16} className="text-text-muted" />}
                iconBg="bg-surface-raised"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{p.job_name}</p>
                  <p className="text-xs text-text-muted truncate mt-0.5">{p.address || 'No address'}</p>
                </div>
                {p.takeoff_status === 'processing' ? (
                  <span className="text-xs font-medium text-primary shrink-0">Processing…</span>
                ) : !p.has_blueprint ? (
                  <span className="text-xs text-text-muted shrink-0">Upload blueprint</span>
                ) : (
                  <span className="text-xs text-text-muted shrink-0">Start takeoff</span>
                )}
                <ChevronRight size={15} className="text-text-muted shrink-0" />
              </ProjectCard>
            ))}
            {notStarted.length === 0 && (
              <div className="px-5 py-5 text-sm text-text-muted italic">
                All projects have takeoffs
              </div>
            )}
          </TakeoffSection>

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

function TakeoffSection({ title, count, dotColor, textColor, children }: {
  title: string
  count: number
  dotColor: string
  textColor: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
        <p className="text-xs font-semibold uppercase tracking-widest text-text-muted">{title}</p>
        <span className={`text-xs font-semibold tabular-nums ${textColor}`}>{count}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  )
}

function ProjectCard({ onClick, icon, iconBg, children }: {
  onClick: () => void
  icon: React.ReactNode
  iconBg: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-4 bg-surface border border-border rounded-2xl hover:border-border-bright hover:bg-surface-raised transition-all duration-150 text-left group"
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${iconBg}`}>
        {icon}
      </div>
      {children}
    </button>
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
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-surface border-l border-border z-50 flex flex-col animate-in fade-in duration-150">
        <div className="px-6 py-5 border-b border-border">
          <h2 className="text-base font-semibold text-text-primary">New Project</h2>
          <p className="text-sm text-text-secondary mt-1">Create a project and upload the blueprint PDF.</p>
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
