'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  Clock,
  Database,
  FileText,
  Lock,
  PlusCircle,
  Search,
} from 'lucide-react'
import { listV2Projects } from '@/lib/vendy/takeoffs-v2-api'
import type { V2ProjectSummary } from '@/lib/vendy/types'

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

type V2Section = 'in-progress' | 'locked' | null
type View = 'hub' | 'v2-list'

// ── Main component ────────────────────────────────────────────────────────────

export default function TakeoffHubV2Client() {
  const router = useRouter()

  const [v2Projects, setV2Projects] = useState<V2ProjectSummary[]>([])
  const [v2Loading, setV2Loading] = useState(true)
  const [v2Error, setV2Error] = useState(false)
  const [search, setSearch] = useState('')

  const [view, setView] = useState<View>('hub')
  const [v2Section, setV2Section] = useState<V2Section>(null)

  useEffect(() => {
    listV2Projects()
      .then(data => { setV2Projects(data); setV2Error(false) })
      .catch(() => setV2Error(true))
      .finally(() => setV2Loading(false))
  }, [])

  const activeList = v2Projects.filter(isActive)
  const completeList = v2Projects.filter(isComplete)
  const lockedList = v2Projects.filter(isLocked)
  const inProgressList = [...activeList, ...completeList]

  function filteredList(list: V2ProjectSummary[]) {
    if (!search) return list
    const q = search.toLowerCase()
    return list.filter(
      p => p.job_name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q),
    )
  }

  // ── Section list view ─────────────────────────────────────────────────────
  if (view === 'v2-list' && v2Section !== null) {
    const sectionMeta: Record<NonNullable<V2Section>, { title: string; color: string }> = {
      'in-progress': { title: 'Projects in Progress', color: 'text-warning' },
      locked:        { title: 'Approved & Locked',    color: 'text-success' },
    }
    const { title, color } = sectionMeta[v2Section]

    // Build list content
    let listContent: React.ReactNode
    if (v2Section === 'in-progress') {
      const shownComplete = filteredList(completeList)
      const shownActive = filteredList(activeList)
      const totalShown = shownComplete.length + shownActive.length

      listContent = totalShown === 0 ? (
        <p className="text-center py-16 text-[13px] text-text-muted">
          {search ? 'No projects match your search.' : 'Nothing here yet.'}
        </p>
      ) : (
        <div className="space-y-2">
          {shownComplete.length > 0 && (
            <>
              <SectionLabel label="Awaiting approval" />
              {shownComplete.map(p => (
                <V2ProjectRow
                  key={p.project_id}
                  project={p}
                  onClick={() => router.push(`/vendy/takeoffs/${p.project_id}`)}
                />
              ))}
            </>
          )}
          {shownActive.length > 0 && (
            <>
              <SectionLabel
                label="In progress"
                className={shownComplete.length > 0 ? 'mt-5' : ''}
              />
              {shownActive.map(p => (
                <V2ProjectRow
                  key={p.project_id}
                  project={p}
                  onClick={() => router.push(`/vendy/takeoffs/${p.project_id}`)}
                />
              ))}
            </>
          )}
        </div>
      )
    } else {
      const shown = filteredList(lockedList)
      listContent = shown.length === 0 ? (
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
      )
    }

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
        {listContent}
      </div>
    )
  }

  // ── Hub overview ──────────────────────────────────────────────────────────
  return (
    <div className="animate-in fade-in">
      <div className="mb-8">
        <h1 className="text-[18px] font-semibold text-text-primary tracking-tight">Takeoffs</h1>
        <p className="text-[13px] text-text-secondary mt-1">
          Import projects, run agents, and approve for bid generation.
        </p>
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
          {/* Projects in Progress */}
          <HubCard
            icon={<Clock size={22} className="text-warning" />}
            iconBg="bg-warning-bg"
            title="Projects in Progress"
            count={inProgressList.length}
            countColor="text-warning bg-warning-bg"
            description="Projects currently being prepared or awaiting approval before bid generation."
            ctaLabel="View Projects"
            onClick={() => { setV2Section('in-progress'); setView('v2-list') }}
            disabled={inProgressList.length === 0}
          />

          {/* Approved & Locked */}
          <HubCard
            icon={<Lock size={22} className="text-success" />}
            iconBg="bg-success-bg"
            title="Approved & Locked"
            count={lockedList.length}
            countColor="text-success bg-success-bg"
            description="Finalized takeoffs approved for bid generation. Further edits are locked."
            ctaLabel="View Approved Projects"
            onClick={() => { setV2Section('locked'); setView('v2-list') }}
            disabled={lockedList.length === 0}
          />

          {/* Add New Project */}
          <HubCard
            icon={<PlusCircle size={22} className="text-primary" />}
            iconBg="bg-primary-light"
            title="Add New Project"
            description="Import a project and prepare it for takeoff review and bid generation."
            ctaLabel="Add Project"
            onClick={() => router.push('/vendy/takeoffs/new')}
            dashed
          />
        </div>
      )}
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
  ctaLabel,
  onClick,
  disabled,
  dashed,
}: {
  icon: React.ReactNode
  iconBg: string
  title: string
  count?: number
  countColor?: string
  description: string
  ctaLabel: string
  onClick: () => void
  disabled?: boolean
  dashed?: boolean
}) {
  return (
    <div
      className={`bg-surface border rounded-[14px] p-6 flex flex-col gap-4 transition-all duration-150 hover:border-primary-mid hover:shadow-glow group ${
        dashed ? 'border-dashed border-border-bright' : 'border-border'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${iconBg}`}>
          {icon}
        </div>
        {count !== undefined && countColor && (
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${countColor}`}>
            {count}
          </span>
        )}
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
        {disabled ? 'None yet' : ctaLabel} {!disabled && <ChevronRight size={13} />}
      </button>
    </div>
  )
}

function SectionLabel({ label, className = '' }: { label: string; className?: string }) {
  return (
    <p
      className={`text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-2 mt-1 ${className}`}
    >
      {label}
    </p>
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
      <ChevronRight
        size={14}
        className="text-text-muted group-hover:text-text-secondary transition-colors shrink-0"
      />
    </button>
  )
}

function SourceBadge({ source }: { source: string }) {
  if (source === 'airtable') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-violet-600 bg-violet-50 border border-violet-200">
        Contracted
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-text-muted bg-surface-raised border border-border">
      Imported
    </span>
  )
}

function V2StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:     { label: 'Pending',   cls: 'text-text-muted bg-surface-raised border border-border' },
    in_progress: { label: 'Running…', cls: 'text-primary bg-primary-light' },
    complete:    { label: 'Complete',  cls: 'text-warning bg-warning-bg' },
    locked:      { label: 'Locked',    cls: 'text-success bg-success-bg' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: 'text-text-muted bg-surface-raised' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}
