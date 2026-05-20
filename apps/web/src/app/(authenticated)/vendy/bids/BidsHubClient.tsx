'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, ChevronRight, CheckCircle, Clock, FileOutput,
  ArrowRight, AlertTriangle, Loader2, FileText,
} from 'lucide-react'
import { getProjects, getAllBidsForHub } from '@/lib/vendy/api'
import type { ProjectSummary, BidDocument } from '@/lib/vendy/types'

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

type ProjectGroup = 'needs_review' | 'in_progress' | 'completed'

const TERMINAL = new Set(['awarded', 'not_awarded', 'rejected'])
const PENDING = new Set(['needs_review', 'failed'])

function getProjectGroup(bids: BidDocument[]): ProjectGroup {
  if (!bids.length) return 'needs_review'
  const active = bids.filter(b => b.status !== 'generating')
  if (!active.length) return 'needs_review'
  if (active.every(b => TERMINAL.has(b.status))) return 'completed'
  if (active.some(b => PENDING.has(b.status))) return 'needs_review'
  return 'in_progress'
}

export default function BidsHubClient() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [bidsMap, setBidsMap] = useState<Map<string, BidDocument[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [serviceOffline, setServiceOffline] = useState(false)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      try { setProjects(await getProjects()) } catch { /* ignore */ }
      try {
        const bids = await getAllBidsForHub()
        const map = new Map<string, BidDocument[]>()
        for (const bid of bids) {
          const arr = map.get(bid.project_id) ?? []
          arr.push(bid)
          map.set(bid.project_id, arr)
        }
        setBidsMap(map)
      } catch {
        setServiceOffline(true)
      }
      setLoading(false)
    }
    load()
  }, [])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const approvedProjects = projects.filter(p => p.takeoff_status === 'approved')
  const filtered = approvedProjects.filter(p =>
    !query ||
    p.job_name.toLowerCase().includes(query.toLowerCase()) ||
    p.address.toLowerCase().includes(query.toLowerCase()),
  )

  // Projects with at least one bid, grouped
  const bidProjects = projects.filter(p => (bidsMap.get(p.project_id)?.length ?? 0) > 0)
  const needsReview = bidProjects.filter(p => getProjectGroup(bidsMap.get(p.project_id)!) === 'needs_review')
  const inProgress = bidProjects.filter(p => getProjectGroup(bidsMap.get(p.project_id)!) === 'in_progress')
  const completed = bidProjects.filter(p => getProjectGroup(bidsMap.get(p.project_id)!) === 'completed')

  // Ready-to-bid: approved takeoff, no bids yet
  const readyProjects = approvedProjects.filter(p => !bidsMap.has(p.project_id)).slice(0, 6)

  // Summary stats
  const totalBidValue = Array.from(bidsMap.values()).flat().reduce((s, b) => s + (b.subtotal ?? 0), 0)
  const totalNeedsReview = Array.from(bidsMap.values()).flat().filter(b => b.status === 'needs_review' || b.status === 'approved').length

  return (
    <div className="animate-in fade-in max-w-3xl">
      <div className="mb-7">
        <h1 className="text-[18px] font-semibold text-text-primary tracking-tight">Bid Generator</h1>
        <p className="text-[13px] text-text-secondary mt-1">
          Generate, review, approve, and download bids for every vendor across all projects.
        </p>
      </div>

      {/* Summary stats */}
      {!loading && bidsMap.size > 0 && (
        <div className="grid grid-cols-3 gap-3 mb-7">
          <StatCard label="Active projects" value={String(bidProjects.length + readyProjects.length)} />
          <StatCard label="Pending review" value={String(totalNeedsReview)} accent={totalNeedsReview > 0 ? 'text-warning' : undefined} />
          <StatCard label="Total bid value" value={`$${(totalBidValue / 1000).toFixed(0)}k`} accent="text-primary" />
        </div>
      )}

      {serviceOffline && (
        <div className="flex items-start gap-3 px-4 py-3 mb-6 bg-warning-bg border border-warning/20 rounded-xl">
          <AlertTriangle size={14} className="text-warning mt-0.5 shrink-0" />
          <div>
            <p className="text-[12px] font-medium text-text-primary">Bid generator offline</p>
            <p className="text-[11px] text-text-secondary mt-0.5">
              Run <code className="font-mono bg-surface px-1 py-0.5 rounded text-[10px]">bash start-dev.sh</code> in{' '}
              <code className="font-mono bg-surface px-1 py-0.5 rounded text-[10px]">services/bid-generator</code>
            </p>
          </div>
        </div>
      )}

      {/* Project search combobox */}
      <div className="mb-10" ref={dropdownRef}>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-2">Select a project</p>
        <div className="relative">
          <div
            className={`flex items-center gap-3 h-12 px-4 bg-surface border rounded-xl cursor-text transition-colors ${
              open ? 'border-primary ring-1 ring-primary/20' : 'border-border hover:border-border-bright'
            }`}
            onClick={() => { setOpen(true); inputRef.current?.focus() }}
          >
            <Search size={16} className="text-text-muted shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true) }}
              onFocus={() => setOpen(true)}
              placeholder="Search projects with approved takeoffs…"
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
            {loading && <Loader2 size={14} className="animate-spin text-text-muted shrink-0" />}
          </div>

          {open && (
            <div className="absolute top-full left-0 right-0 mt-1.5 bg-surface border border-border rounded-xl shadow-xl overflow-hidden z-50 max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-text-muted">
                  {approvedProjects.length === 0 ? 'No projects with approved takeoffs yet.' : 'No matches.'}
                </div>
              ) : (
                filtered.map(p => {
                  const bids = bidsMap.get(p.project_id) ?? []
                  const group = bids.length > 0 ? getProjectGroup(bids) : null
                  return (
                    <button
                      key={p.project_id}
                      onClick={() => { setOpen(false); setQuery(''); router.push(`/vendy/bids/${p.project_id}`) }}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-raised transition-colors text-left border-t border-border first:border-t-0"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{p.job_name}</p>
                        {p.address && <p className="text-xs text-text-muted truncate mt-0.5">{p.address}</p>}
                      </div>
                      {group === null && <span className="text-xs text-text-muted shrink-0">No bids yet</span>}
                      {group === 'needs_review' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-warning/15 text-warning shrink-0">
                          <Clock size={10} /> Needs Review
                        </span>
                      )}
                      {group === 'in_progress' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/15 text-primary shrink-0">
                          In Progress
                        </span>
                      )}
                      {group === 'completed' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-success/15 text-success shrink-0">
                          <CheckCircle size={10} /> Completed
                        </span>
                      )}
                      <ChevronRight size={14} className="text-text-muted shrink-0" />
                    </button>
                  )
                })
              )}
            </div>
          )}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-surface-raised rounded-2xl animate-pulse" />)}
        </div>
      ) : (
        <div className="space-y-10">

          {needsReview.length > 0 && (
            <ProjectSection
              title="Needs Review"
              projects={needsReview}
              bidsMap={bidsMap}
              accentClass="bg-warning/15 text-warning"
              icon={<Clock size={16} className="text-warning" />}
              onSelect={p => router.push(`/vendy/bids/${p.project_id}`)}
            />
          )}

          {inProgress.length > 0 && (
            <ProjectSection
              title="In Progress"
              projects={inProgress}
              bidsMap={bidsMap}
              accentClass="bg-primary/15 text-primary"
              icon={<FileText size={16} className="text-primary" />}
              onSelect={p => router.push(`/vendy/bids/${p.project_id}`)}
            />
          )}

          {completed.length > 0 && (
            <ProjectSection
              title="Completed"
              projects={completed}
              bidsMap={bidsMap}
              accentClass="bg-success/15 text-success"
              icon={<CheckCircle size={16} className="text-success" />}
              onSelect={p => router.push(`/vendy/bids/${p.project_id}`)}
            />
          )}

          {readyProjects.length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
                Ready to bid
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {readyProjects.map(p => (
                  <button
                    key={p.project_id}
                    onClick={() => router.push(`/vendy/bids/${p.project_id}`)}
                    className="flex items-center gap-3 px-4 py-3.5 bg-surface border border-border rounded-xl hover:border-primary/40 hover:bg-primary/5 transition-all duration-150 text-left group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-surface-raised flex items-center justify-center shrink-0">
                      <FileOutput size={14} className="text-text-muted" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-primary truncate">{p.job_name}</p>
                      {p.address && <p className="text-xs text-text-muted truncate">{p.address}</p>}
                    </div>
                    <ArrowRight size={14} className="text-text-muted group-hover:text-primary transition-colors shrink-0" />
                  </button>
                ))}
              </div>
              {approvedProjects.filter(p => !bidsMap.has(p.project_id)).length > 6 && (
                <p className="text-xs text-text-muted mt-3 text-center">
                  +{approvedProjects.filter(p => !bidsMap.has(p.project_id)).length - 6} more — use search above
                </p>
              )}
            </section>
          )}

          {bidProjects.length === 0 && readyProjects.length === 0 && (
            <div className="text-center py-16 text-text-muted text-sm">
              No projects with approved takeoffs yet.
              <br />
              <span className="text-xs mt-1 block">Approve a takeoff in Vendy → Takeoffs first.</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ProjectSection({
  title, projects, bidsMap, accentClass, icon, onSelect,
}: {
  title: string
  projects: ProjectSummary[]
  bidsMap: Map<string, BidDocument[]>
  accentClass: string
  icon: React.ReactNode
  onSelect: (p: ProjectSummary) => void
}) {
  return (
    <section>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-3">{title}</p>
      <div className="space-y-2">
        {projects.map(p => {
          const bids = bidsMap.get(p.project_id) ?? []
          const needsReviewCount = bids.filter(b => b.status === 'needs_review').length
          const approvedCount = bids.filter(b => b.status !== 'generating' && b.status !== 'needs_review' && b.status !== 'failed').length
          const total = bids.reduce((s, b) => s + (b.subtotal ?? 0), 0)

          return (
            <button
              key={p.project_id}
              onClick={() => onSelect(p)}
              className="w-full flex items-center gap-4 px-5 py-4 bg-surface border border-border rounded-[14px] hover:border-border-bright hover:bg-surface-raised transition-all duration-150 text-left group"
            >
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${accentClass}`}>
                {icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-text-primary truncate">{p.job_name}</p>
                <p className="text-[11px] text-text-secondary mt-0.5 truncate">
                  {needsReviewCount > 0
                    ? `${needsReviewCount} bid${needsReviewCount !== 1 ? 's' : ''} need review`
                    : `${bids.length} bid${bids.length !== 1 ? 's' : ''} · ${approvedCount} actioned`}
                </p>
              </div>
              {total > 0 && (
                <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0">
                  <p className="text-[12px] font-semibold text-text-primary tabular-nums font-mono">${fmt(total)}</p>
                  <p className="text-[10px] text-text-secondary">{bids.length} vendor{bids.length !== 1 ? 's' : ''}</p>
                </div>
              )}
              <ChevronRight size={15} className="text-text-muted group-hover:text-text-secondary transition-colors shrink-0" />
            </button>
          )
        })}
      </div>
    </section>
  )
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-surface border border-border rounded-[14px] px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary mb-1">{label}</p>
      <p className={`text-[17px] font-semibold tabular-nums ${accent ?? 'text-text-primary'}`}>{value}</p>
    </div>
  )
}
