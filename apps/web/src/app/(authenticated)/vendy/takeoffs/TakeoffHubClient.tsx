'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Lock, Clock, PlusCircle, Search, ChevronRight,
  AlertTriangle, CheckCircle, FileText, Plus, ArrowLeft,
} from 'lucide-react'
import { getProjects, createProject } from '@/lib/vendy/api'
import type { ProjectSummary } from '@/lib/vendy/types'

type ActiveSection = 'approved' | 'under_review' | 'new_project' | null

export default function TakeoffHubClient() {
  const router = useRouter()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [serviceOffline, setServiceOffline] = useState(false)
  const [search, setSearch] = useState('')
  const [activeSection, setActiveSection] = useState<ActiveSection>(null)
  const [showAddPanel, setShowAddPanel] = useState(false)

  useEffect(() => {
    getProjects()
      .then(data => { setProjects(data); setServiceOffline(false) })
      .catch(() => setServiceOffline(true))
      .finally(() => setLoading(false))
  }, [])

  const approved   = projects.filter(p => p.takeoff_status === 'approved')
  const underReview = projects.filter(p => p.takeoff_status === 'needs_approval')
  const notStarted  = projects.filter(p => p.takeoff_status === 'none' || p.takeoff_status === 'processing')

  function sectionProjects() {
    const base = activeSection === 'approved' ? approved
      : activeSection === 'under_review' ? underReview
      : notStarted
    if (!search) return base
    return base.filter(p =>
      p.job_name.toLowerCase().includes(search.toLowerCase()) ||
      p.address.toLowerCase().includes(search.toLowerCase()),
    )
  }

  function handleProjectClick(p: ProjectSummary) {
    if (p.takeoff_status === 'needs_approval' && p.takeoff_job_id) {
      router.push(`/vendy/takeoffs/${p.project_id}/review/${p.takeoff_job_id}`)
    } else {
      router.push(`/vendy/takeoffs/${p.project_id}`)
    }
  }

  const sectionMeta: Record<NonNullable<ActiveSection>, { title: string; color: string }> = {
    approved:     { title: 'Approved & Locked', color: 'text-success' },
    under_review: { title: 'Under Review',       color: 'text-warning' },
    new_project:  { title: 'Work on New Project', color: 'text-text-secondary' },
  }

  if (activeSection !== null) {
    const { title, color } = sectionMeta[activeSection]
    const list = sectionProjects()
    return (
      <div className="animate-in fade-in">
        {/* Back + header */}
        <div className="flex items-center justify-between mb-7 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setActiveSection(null); setSearch('') }}
              className="flex items-center gap-1.5 text-[12px] text-primary hover:text-primary/80 transition-colors"
            >
              <ArrowLeft size={14} /> Takeoffs
            </button>
            <span className="text-text-muted text-[12px]">/</span>
            <span className={`text-[12px] font-medium ${color}`}>{title}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter projects…"
                className="bg-surface border border-border text-text-primary text-[12px] rounded-lg pl-9 pr-4 h-8 focus:outline-none focus:border-primary transition-colors w-48"
              />
            </div>
            {activeSection === 'new_project' && (
              <button
                onClick={() => setShowAddPanel(true)}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
              >
                <Plus size={13} /> New Project
              </button>
            )}
          </div>
        </div>

        {serviceOffline && (
          <div className="mb-5 flex items-center gap-3 px-4 py-3 bg-warning-bg border border-warning/20 rounded-xl text-warning text-[12px]">
            <AlertTriangle size={14} className="shrink-0" />
            Takeoff agent offline — data may be unavailable.
          </div>
        )}

        {list.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-[13px] text-text-muted">
              {search ? 'No projects match your search.' : 'Nothing here yet.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeSection === 'new_project' ? (
              <>
                {/* Projects with blueprints (no takeoff) */}
                {list.filter(p => p.has_blueprint).length > 0 && (
                  <SectionLabel label="Blueprint uploaded — ready to generate" />
                )}
                {list.filter(p => p.has_blueprint).map(p => (
                  <ProjectRow
                    key={p.project_id}
                    project={p}
                    onClick={() => handleProjectClick(p)}
                    badge={
                      p.takeoff_status === 'processing'
                        ? <Badge text="Processing…" color="text-primary" bg="bg-primary-light" />
                        : <Badge text="No takeoff" color="text-warning" bg="bg-warning-bg" />
                    }
                  />
                ))}
                {/* Projects without blueprints */}
                {list.filter(p => !p.has_blueprint).length > 0 && (
                  <SectionLabel label="No blueprint uploaded" className="mt-5" />
                )}
                {list.filter(p => !p.has_blueprint).map(p => (
                  <ProjectRow
                    key={p.project_id}
                    project={p}
                    onClick={() => handleProjectClick(p)}
                    badge={<Badge text="No blueprint" color="text-text-muted" bg="bg-surface-raised border border-border" />}
                  />
                ))}
              </>
            ) : (
              list.map(p => (
                <ProjectRow
                  key={p.project_id}
                  project={p}
                  onClick={() => handleProjectClick(p)}
                  badge={
                    activeSection === 'approved'
                      ? <span className="flex items-center gap-1 text-[11px] font-medium text-success"><CheckCircle size={12} /> Locked</span>
                      : <span className="text-[11px] font-medium text-warning">Review →</span>
                  }
                />
              ))
            )}
          </div>
        )}

        {showAddPanel && (
          <AddProjectSlideOver
            onClose={() => setShowAddPanel(false)}
            onCreated={(id) => { setShowAddPanel(false); router.push(`/vendy/takeoffs/${id}`) }}
          />
        )}
      </div>
    )
  }

  // ── Hub overview: 3 large cards ──────────────────────────────────────────────
  return (
    <div className="animate-in fade-in">
      <div className="mb-8">
        <h1 className="text-[18px] font-semibold text-text-primary tracking-tight">Takeoffs</h1>
        <p className="text-[13px] text-text-secondary mt-1">
          Upload blueprints, extract quantities, and approve for bid generation.
        </p>
      </div>

      {serviceOffline && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 bg-warning-bg border border-warning/20 rounded-xl text-warning text-[12px]">
          <AlertTriangle size={14} className="shrink-0" />
          Takeoff agent offline — project data may be unavailable.
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => <div key={i} className="h-48 bg-surface rounded-[14px] animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Under Review */}
          <HubCard
            icon={<Clock size={22} className="text-warning" />}
            iconBg="bg-warning-bg"
            title="Under Review"
            count={underReview.length}
            countColor="text-warning bg-warning-bg"
            description="Takeoffs awaiting PM review and quantity approval before locking."
            onClick={() => setActiveSection('under_review')}
            disabled={underReview.length === 0}
          />

          {/* Approved & Locked */}
          <HubCard
            icon={<Lock size={22} className="text-success" />}
            iconBg="bg-success-bg"
            title="Approved & Locked"
            count={approved.length}
            countColor="text-success bg-success-bg"
            description="Locked takeoffs ready for bid generation. No further edits allowed."
            onClick={() => setActiveSection('approved')}
            disabled={approved.length === 0}
          />

          {/* Work on New Project */}
          <HubCard
            icon={<PlusCircle size={22} className="text-primary" />}
            iconBg="bg-primary-light"
            title="Work on New Project"
            count={notStarted.length}
            countColor="text-text-secondary bg-surface-raised border border-border"
            description="Projects without an approved takeoff. Upload blueprints and generate."
            onClick={() => setActiveSection('new_project')}
            cta="+ New Project"
            onCtaClick={() => setShowAddPanel(true)}
          />
        </div>
      )}

      {showAddPanel && (
        <AddProjectSlideOver
          onClose={() => setShowAddPanel(false)}
          onCreated={(id) => { setShowAddPanel(false); router.push(`/vendy/takeoffs/${id}`) }}
        />
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HubCard({
  icon, iconBg, title, count, countColor, description, onClick, disabled, cta, onCtaClick,
}: {
  icon: React.ReactNode
  iconBg: string
  title: string
  count: number
  countColor: string
  description: string
  onClick: () => void
  disabled?: boolean
  cta?: string
  onCtaClick?: () => void
}) {
  return (
    <div className="bg-surface border border-border rounded-[14px] p-6 flex flex-col gap-4 transition-all duration-150 hover:border-primary-mid hover:shadow-glow group">
      <div className="flex items-start justify-between">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${countColor}`}>
          {count}
        </span>
      </div>
      <div className="flex-1">
        <p className="text-[14px] font-semibold text-text-primary mb-1">{title}</p>
        <p className="text-[12px] text-text-secondary leading-relaxed">{description}</p>
      </div>
      <div className="flex items-center gap-2 mt-auto">
        <button
          onClick={onClick}
          disabled={disabled}
          className="flex items-center gap-1.5 text-[12px] font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-30 disabled:cursor-default group-hover:translate-x-0.5"
        >
          {disabled ? 'None yet' : 'View all'} {!disabled && <ChevronRight size={13} />}
        </button>
        {cta && onCtaClick && (
          <>
            <span className="text-border">·</span>
            <button
              onClick={onCtaClick}
              className="text-[12px] font-medium text-primary hover:text-primary/80 transition-colors"
            >
              {cta}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function SectionLabel({ label, className = '' }: { label: string; className?: string }) {
  return (
    <p className={`text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-2 mt-1 ${className}`}>
      {label}
    </p>
  )
}

function Badge({ text, color, bg }: { text: string; color: string; bg: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${color} ${bg}`}>
      {text}
    </span>
  )
}

function ProjectRow({ project: p, onClick, badge }: {
  project: ProjectSummary
  onClick: () => void
  badge: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-3.5 bg-surface border border-border rounded-[14px] hover:border-border-bright hover:bg-surface-raised transition-all duration-150 text-left group"
    >
      <div className="w-8 h-8 rounded-lg bg-surface-raised flex items-center justify-center shrink-0 group-hover:bg-border transition-colors">
        <FileText size={14} className="text-text-muted" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-text-primary truncate">{p.job_name}</p>
        {p.address && <p className="text-[11px] text-text-muted truncate mt-0.5">{p.address}</p>}
      </div>
      <div className="shrink-0">{badge}</div>
      <ChevronRight size={14} className="text-text-muted group-hover:text-text-secondary transition-colors shrink-0" />
    </button>
  )
}

function AddProjectSlideOver({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (projectId: string) => void
}) {
  const [jobName, setJobName] = useState('')
  const [address, setAddress] = useState('')
  const [architect, setArchitect] = useState('')
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
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full max-w-md bg-surface border-l border-border z-50 flex flex-col animate-in fade-in duration-150">
        <div className="px-6 py-5 border-b border-border">
          <h2 className="text-[15px] font-semibold text-text-primary">New Project</h2>
          <p className="text-[12px] text-text-secondary mt-1">Create a project and upload the blueprint PDF.</p>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 flex flex-col px-6 py-6 gap-5 overflow-y-auto">
          <Field label="Project Name" required>
            <input
              value={jobName}
              onChange={e => setJobName(e.target.value)}
              placeholder="502 Wakeman - Halpin"
              className="w-full bg-surface-raised border border-border text-text-primary text-[12px] rounded-lg px-3 h-9 focus:outline-none focus:border-primary transition-colors"
              required
            />
          </Field>
          <Field label="Address" required>
            <input
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="502 Markman Ave, Wheaton, IL"
              className="w-full bg-surface-raised border border-border text-text-primary text-[12px] rounded-lg px-3 h-9 focus:outline-none focus:border-primary transition-colors"
              required
            />
          </Field>
          <Field label="Architect">
            <input
              value={architect}
              onChange={e => setArchitect(e.target.value)}
              placeholder="e.g. Drafting Studio LLC"
              className="w-full bg-surface-raised border border-border text-text-primary text-[12px] rounded-lg px-3 h-9 focus:outline-none focus:border-primary transition-colors"
            />
          </Field>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="mt-auto flex gap-3">
            <button type="button" onClick={onClose} className="flex-1 h-9 rounded-lg border border-border text-text-secondary text-[12px] hover:border-border-bright transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 h-9 rounded-lg bg-primary text-white text-[12px] font-medium hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-50"
            >
              {loading ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </div>
    </>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary block mb-1.5">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}
