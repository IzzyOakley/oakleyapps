'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronRight,
  Clock,
  Database,
  FileText,
  FolderOpen,
  Lock,
  Loader2,
  Play,
  Plus,
  Search,
} from 'lucide-react'
import { listV2Projects } from '@/lib/vendy/takeoffs-v2-api'
import { getProjects } from '@/lib/vendy/api'
import type { V2ProjectSummary, ProjectSummary } from '@/lib/vendy/types'

// ── Status helpers ────────────────────────────────────────────────────────────

function isActive(p: V2ProjectSummary) {
  return p.status === 'pending' || p.status === 'in_progress'
}
function isComplete(p: V2ProjectSummary) {
  return p.status === 'complete'
}
function isLocked(p: V2ProjectSummary) {
  return p.status === 'locked'
}

type V2Section = 'active' | 'complete' | 'locked' | null
type View = 'hub' | 'v2-list' | 'v1-list'

// ── Main component ────────────────────────────────────────────────────────────

export default function TakeoffHubV2Client() {
  const router = useRouter()

  const [v2Projects, setV2Projects] = useState<V2ProjectSummary[]>([])
  const [v1Projects, setV1Projects] = useState<ProjectSummary[]>([])
  const [v2Loading, setV2Loading] = useState(true)
  const [v1Loading, setV1Loading] = useState(false)
  const [v2Error, setV2Error] = useState(false)
  const [search, setSearch] = useState('')

  const [view, setView] = useState<View>('hub')
  const [v2Section, setV2Section] = useState<V2Section>(null)
  const [showV1, setShowV1] = useState(false)

  // Load v2 projects
  useEffect(() => {
    listV2Projects()
      .then(data => { setV2Projects(data); setV2Error(false) })
      .catch(() => setV2Error(true))
      .finally(() => setV2Loading(false))
  }, [])

  // Load v1 projects lazily when section expanded
  useEffect(() => {
    if (!showV1 || v1Projects.length > 0) return
    setV1Loading(true)
    getProjects()
      .then(setV1Projects)
      .catch(() => {})
      .finally(() => setV1Loading(false))
  }, [showV1, v1Projects.length])

  const activeList = v2Projects.filter(isActive)
  const completeList = v2Projects.filter(isComplete)
  const lockedList = v2Projects.filter(isLocked)

  function filteredList(list: V2ProjectSummary[]) {
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter(
      p => p.job_name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q),
    )
  }

  // ── Section list view (v2) ────────────────────────────────────────────────
  if (view === 'v2-list' && v2Section !== null) {
    const sectionMeta = {
      active:   { title: 'Active Projects',     list: activeList,   color: 'text-primary' },
      complete: { title: 'Ready to Approve',    list: completeList, color: 'text-warning' },
      locked:   { title: 'Approved & Locked',   list: lockedList,   color: 'text-success' },
    }
    const { title, list, color } = sectionMeta[v2Section]
    const shown = filteredList(list)

    return (
      <div className="animate-in fade-in">
        <div className="flex items-center justify-between mb-7 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setView('hub'); setSearch('') }}
              className="flex items-center gap-1.5 text-[12px] text-primary hover:text-primary/80 transition-colors"
            >
              <ArrowLeft size={14} /> Takeoffs
            </button>
            <span className="text-text-muted text-[12px]">/</span>
            <span className={`text-[12px] font-medium ${color}`}>{title}</span>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter projects…"
              className="bg-surface border border-border text-text-primary text-[12px] rounded-lg pl-9 pr-4 h-8 focus:outline-none focus:border-primary transition-colors w-48"
            />
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="text-center py-16 text-[13px] text-text-muted">
            {search ? 'No projects match your search.' : 'Nothing here yet.'}
          </p>
        ) : (
          <div className="space-y-2">
            {shown.map(p => (
              <V2ProjectRow
                key={p.project_id}
                project={p}
                onClick={() => router.push(`/vendy/takeoffs/${p.project_id}`)}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── V1 list view ─────────────────────────────────────────────────────────
  if (view === 'v1-list') {
    const shown = search
      ? v1Projects.filter(p =>
          p.job_name.toLowerCase().includes(search.toLowerCase()) ||
          p.address.toLowerCase().includes(search.toLowerCase()),
        )
      : v1Projects

    return (
      <div className="animate-in fade-in">
        <div className="flex items-center justify-between mb-7 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setView('hub'); setSearch('') }}
              className="flex items-center gap-1.5 text-[12px] text-primary hover:text-primary/80 transition-colors"
            >
              <ArrowLeft size={14} /> Takeoffs
            </button>
            <span className="text-text-muted text-[12px]">/</span>
            <span className="text-[12px] font-medium text-text-secondary">Legacy v1 Projects</span>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Filter…"
              className="bg-surface border border-border text-text-primary text-[12px] rounded-lg pl-9 pr-4 h-8 focus:outline-none focus:border-primary transition-colors w-48"
            />
          </div>
        </div>
        {v1Loading ? (
          <div className="flex justify-center py-16">
            <Loader2 size={20} className="animate-spin text-text-muted" />
          </div>
        ) : shown.length === 0 ? (
          <p className="text-center py-16 text-[13px] text-text-muted">
            {search ? 'No projects match your search.' : 'No legacy projects.'}
          </p>
        ) : (
          <div className="space-y-2">
            {shown.map(p => {
              const path =
                p.takeoff_status === 'needs_approval' && p.takeoff_job_id
                  ? `/vendy/takeoffs/${p.project_id}/review/${p.takeoff_job_id}`
                  : `/vendy/takeoffs/${p.project_id}`
              return (
                <button
                  key={p.project_id}
                  onClick={() => router.push(path)}
                  className="w-full flex items-center gap-4 px-5 py-3.5 bg-surface border border-border rounded-[14px] hover:border-border-bright hover:bg-surface-raised transition-all duration-150 text-left group"
                >
                  <div className="w-8 h-8 rounded-lg bg-surface-raised flex items-center justify-center shrink-0">
                    <FileText size={14} className="text-text-muted" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-text-primary truncate">{p.job_name}</p>
                    {p.address && (
                      <p className="text-[11px] text-text-muted truncate mt-0.5">{p.address}</p>
                    )}
                  </div>
                  <V1StatusBadge status={p.takeoff_status} />
                  <ChevronRight size={14} className="text-text-muted shrink-0" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // ── Hub overview ──────────────────────────────────────────────────────────
  return (
    <div className="animate-in fade-in">
      <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-[18px] font-semibold text-text-primary tracking-tight">Takeoffs</h1>
          <p className="text-[13px] text-text-secondary mt-1">
            Import projects, run agents, and approve for bid generation.
          </p>
        </div>
        <button
          onClick={() => router.push('/vendy/takeoffs/new')}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-[12px] font-medium bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors"
        >
          <Plus size={13} /> New v2 Project
        </button>
      </div>

      {v2Error && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 bg-warning-bg border border-warning/20 rounded-xl text-warning text-[12px]">
          <AlertTriangle size={14} className="shrink-0" />
          Takeoff agent offline — project data may be unavailable.
        </div>
      )}

      {v2Loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-48 bg-surface rounded-[14px] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Active */}
          <HubCard
            icon={<Play size={22} className="text-primary" />}
            iconBg="bg-primary-light"
            title="Active"
            count={activeList.length}
            countColor="text-primary bg-primary-light"
            description="Projects with agents pending or running. Start or resume agent execution."
            onClick={() => { setV2Section('active'); setView('v2-list') }}
            disabled={activeList.length === 0}
          />

          {/* Ready to Approve */}
          <HubCard
            icon={<Clock size={22} className="text-warning" />}
            iconBg="bg-warning-bg"
            title="Ready to Approve"
            count={completeList.length}
            countColor="text-warning bg-warning-bg"
            description="Agents have finished. Validate results and approve to generate bids."
            onClick={() => { setV2Section('complete'); setView('v2-list') }}
            disabled={completeList.length === 0}
          />

          {/* Approved & Locked */}
          <HubCard
            icon={<Lock size={22} className="text-success" />}
            iconBg="bg-success-bg"
            title="Approved & Locked"
            count={lockedList.length}
            countColor="text-success bg-success-bg"
            description="Locked takeoffs ready for bid generation. No further edits allowed."
            onClick={() => { setV2Section('locked'); setView('v2-list') }}
            disabled={lockedList.length === 0}
          />
        </div>
      )}

      {/* Legacy v1 section */}
      <div className="mt-8">
        <button
          onClick={() => { setShowV1(v => !v); if (!showV1) setView('hub') }}
          className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-text-muted hover:text-text-secondary transition-colors"
        >
          <span>{showV1 ? '▾' : '▸'}</span>
          Legacy v1 Projects
        </button>

        {showV1 && (
          <div className="mt-3">
            {v1Loading ? (
              <div className="flex justify-center py-8">
                <Loader2 size={18} className="animate-spin text-text-muted" />
              </div>
            ) : v1Projects.length === 0 ? (
              <p className="text-[12px] text-text-muted py-4 text-center">No v1 projects found.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <HubCard
                  icon={<Clock size={20} className="text-warning" />}
                  iconBg="bg-warning-bg"
                  title="Under Review"
                  count={v1Projects.filter(p => p.takeoff_status === 'needs_approval').length}
                  countColor="text-warning bg-warning-bg"
                  description="V1 takeoffs awaiting review."
                  onClick={() => { setView('v1-list') }}
                  disabled={v1Projects.filter(p => p.takeoff_status === 'needs_approval').length === 0}
                />
                <HubCard
                  icon={<CheckCircle size={20} className="text-success" />}
                  iconBg="bg-success-bg"
                  title="Approved"
                  count={v1Projects.filter(p => p.takeoff_status === 'approved').length}
                  countColor="text-success bg-success-bg"
                  description="V1 approved takeoffs."
                  onClick={() => { setView('v1-list') }}
                  disabled={v1Projects.filter(p => p.takeoff_status === 'approved').length === 0}
                />
                <HubCard
                  icon={<FolderOpen size={20} className="text-text-secondary" />}
                  iconBg="bg-surface-raised border border-border"
                  title="All Legacy"
                  count={v1Projects.length}
                  countColor="text-text-secondary bg-surface-raised border border-border"
                  description="All v1 projects."
                  onClick={() => { setView('v1-list') }}
                  disabled={v1Projects.length === 0}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HubCard({
  icon,
  iconBg,
  title,
  count,
  countColor,
  description,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  iconBg: string
  title: string
  count: number
  countColor: string
  description: string
  onClick: () => void
  disabled?: boolean
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
      <button
        onClick={onClick}
        disabled={disabled}
        className="flex items-center gap-1.5 text-[12px] font-medium text-primary hover:text-primary/80 transition-colors disabled:opacity-30 disabled:cursor-default group-hover:translate-x-0.5 mt-auto"
      >
        {disabled ? 'None yet' : 'View all'} {!disabled && <ChevronRight size={13} />}
      </button>
    </div>
  )
}

function V2ProjectRow({
  project: p,
  onClick,
}: {
  project: V2ProjectSummary
  onClick: () => void
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
        {p.address && (
          <p className="text-[11px] text-text-muted truncate mt-0.5">{p.address}</p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <SourceBadge source={p.project_source} />
        {p.dxf_present && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-primary bg-primary-light">
            <Database size={9} /> DXF
          </span>
        )}
        <V2StatusBadge status={p.status} />
      </div>
      <ChevronRight size={14} className="text-text-muted group-hover:text-text-secondary transition-colors shrink-0" />
    </button>
  )
}

function SourceBadge({ source }: { source: string }) {
  if (source === 'airtable') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-violet-600 bg-violet-50 border border-violet-200">
        Airtable
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-text-muted bg-surface-raised border border-border">
      GCS
    </span>
  )
}

function V2StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:     { label: 'Pending',     cls: 'text-text-muted bg-surface-raised border border-border' },
    in_progress: { label: 'Running…',   cls: 'text-primary bg-primary-light' },
    complete:    { label: 'Complete',    cls: 'text-warning bg-warning-bg' },
    locked:      { label: 'Locked',      cls: 'text-success bg-success-bg' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: 'text-text-muted bg-surface-raised' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}

function V1StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    none:          { label: 'No takeoff', cls: 'text-text-muted bg-surface-raised border border-border' },
    processing:    { label: 'Processing', cls: 'text-primary bg-primary-light' },
    needs_approval:{ label: 'Review →',   cls: 'text-warning bg-warning-bg' },
    approved:      { label: 'Approved',   cls: 'text-success bg-success-bg' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: 'text-text-muted bg-surface-raised' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}
