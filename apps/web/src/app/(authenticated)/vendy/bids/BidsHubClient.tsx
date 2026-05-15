'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, ChevronRight, CheckCircle, Clock, FileOutput,
  ArrowRight, AlertTriangle, Loader2,
} from 'lucide-react'
import { getProjects } from '@/lib/vendy/api'
import { getAllBids } from '@/lib/vendy/bids-api'
import type { ProjectSummary } from '@/lib/vendy/types'
import type { Bid } from '@/lib/vendy/bids-api'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function projectBidStatus(bids: Bid[]): 'none' | 'generating' | 'in_progress' | 'complete' {
  if (!bids.length) return 'none'
  if (bids.some(b => b.status === 'generating')) return 'generating'
  if (bids.every(b => b.status === 'approved')) return 'complete'
  return 'in_progress'
}

// ── component ─────────────────────────────────────────────────────────────────

export default function BidsHubClient() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)

  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [bidsMap, setBidsMap] = useState<Map<string, Bid[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [serviceOffline, setServiceOffline] = useState(false)

  // combobox state
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    async function load() {
      try {
        const projs = await getProjects()
        setProjects(projs)
      } catch { /* ignore */ }
      try {
        const bids = await getAllBids()
        const map = new Map<string, Bid[]>()
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

  // close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Only show projects with an approved takeoff in the combobox
  const approvedProjects = projects.filter(p => p.takeoff_status === 'approved')
  const filtered = approvedProjects.filter(p =>
    !query ||
    p.job_name.toLowerCase().includes(query.toLowerCase()) ||
    p.address.toLowerCase().includes(query.toLowerCase()),
  )

  function selectProject(p: ProjectSummary) {
    setOpen(false)
    setQuery('')
    router.push(`/vendy/bids/${p.project_id}`)
  }

  // Active bid projects (have at least one bid generated)
  const activeBidProjects = projects
    .filter(p => (bidsMap.get(p.project_id)?.length ?? 0) > 0)
    .sort((a, b) => {
      const sa = projectBidStatus(bidsMap.get(a.project_id) ?? [])
      const sb = projectBidStatus(bidsMap.get(b.project_id) ?? [])
      const order = { generating: 0, in_progress: 1, complete: 2, none: 3 }
      return order[sa] - order[sb]
    })

  // Ready-to-bid: approved takeoff, no bids yet
  const readyProjects = approvedProjects
    .filter(p => !bidsMap.has(p.project_id))
    .slice(0, 6)

  return (
    <div className="animate-in fade-in max-w-3xl">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Bid Generator</h1>
        <p className="text-sm text-text-muted mt-1">
          Generate reverse bids for every vendor, review, approve, and download.
        </p>
      </div>

      {/* ── Service offline banner ───────────────────────────────────────── */}
      {serviceOffline && (
        <div className="flex items-start gap-3 px-4 py-3 mb-6 bg-warning/10 border border-warning/20 rounded-xl">
          <AlertTriangle size={15} className="text-warning mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-text-primary">Bid generator offline</p>
            <p className="text-xs text-text-muted mt-0.5">
              Run <code className="font-mono bg-surface px-1 py-0.5 rounded text-xs">bash start-dev.sh</code> from{' '}
              <code className="font-mono bg-surface px-1 py-0.5 rounded text-xs">services/bid-generator</code>
            </p>
          </div>
        </div>
      )}

      {/* ── Project search combobox ──────────────────────────────────────── */}
      <div className="mb-10" ref={dropdownRef}>
        <p className="text-xs font-medium uppercase tracking-widest text-text-muted mb-2">
          Select a project
        </p>
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
                  {approvedProjects.length === 0
                    ? 'No projects with approved takeoffs yet.'
                    : 'No matches — try a different name.'}
                </div>
              ) : (
                filtered.map(p => {
                  const bids = bidsMap.get(p.project_id) ?? []
                  const status = projectBidStatus(bids)
                  return (
                    <button
                      key={p.project_id}
                      onClick={() => selectProject(p)}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-raised transition-colors text-left border-t border-border first:border-t-0"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-text-primary truncate">{p.job_name}</p>
                        {p.address && (
                          <p className="text-xs text-text-muted truncate mt-0.5">{p.address}</p>
                        )}
                      </div>
                      {status === 'none' ? (
                        <span className="text-xs text-text-muted shrink-0">No bids yet</span>
                      ) : status === 'generating' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/15 text-primary shrink-0">
                          <Loader2 size={10} className="animate-spin" /> Generating
                        </span>
                      ) : status === 'complete' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-success/15 text-success shrink-0">
                          <CheckCircle size={10} /> Complete
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-warning/15 text-warning shrink-0">
                          <Clock size={10} /> In Progress
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
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-surface-raised rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-10">

          {/* ── Active bid projects ────────────────────────────────────── */}
          {activeBidProjects.length > 0 && (
            <section>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted mb-3">Active</p>
              <div className="space-y-2">
                {activeBidProjects.map(p => {
                  const bids = bidsMap.get(p.project_id) ?? []
                  const status = projectBidStatus(bids)
                  const approvedCount = bids.filter(b => b.status === 'approved').length
                  const total = bids.reduce((s, b) => s + (b.subtotal ?? 0), 0)

                  return (
                    <button
                      key={p.project_id}
                      onClick={() => router.push(`/vendy/bids/${p.project_id}`)}
                      className="w-full flex items-center gap-4 px-5 py-4 bg-surface border border-border rounded-2xl hover:border-border-bright hover:bg-surface-raised transition-all duration-150 text-left group"
                    >
                      {/* Status icon */}
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        status === 'complete' ? 'bg-success/15' :
                        status === 'generating' ? 'bg-primary/15' : 'bg-warning/15'
                      }`}>
                        {status === 'complete'
                          ? <CheckCircle size={16} className="text-success" />
                          : status === 'generating'
                          ? <Loader2 size={16} className="animate-spin text-primary" />
                          : <Clock size={16} className="text-warning" />}
                      </div>

                      {/* Project info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text-primary truncate">{p.job_name}</p>
                        <p className="text-xs text-text-muted mt-0.5 truncate">{p.address}</p>
                      </div>

                      {/* Stats */}
                      <div className="hidden sm:flex flex-col items-end gap-0.5 shrink-0">
                        <p className="text-xs font-semibold text-text-primary tabular-nums">
                          ${fmt(total)}
                        </p>
                        <p className="text-xs text-text-muted">
                          {approvedCount} of {bids.length} approved
                        </p>
                      </div>

                      {/* Status badge */}
                      {status === 'generating' ? (
                        <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/15 text-primary shrink-0 animate-pulse">
                          <Loader2 size={10} className="animate-spin" /> Generating
                        </span>
                      ) : status === 'complete' ? (
                        <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-success/15 text-success shrink-0">
                          <CheckCircle size={10} /> All Approved
                        </span>
                      ) : (
                        <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-warning/15 text-warning shrink-0">
                          Needs Review
                        </span>
                      )}

                      <ChevronRight size={16} className="text-text-muted group-hover:text-text-secondary transition-colors shrink-0" />
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          {/* ── Ready to bid ───────────────────────────────────────────── */}
          {readyProjects.length > 0 && (
            <section>
              <p className="text-xs font-medium uppercase tracking-widest text-text-muted mb-3">
                Ready to bid — approved takeoffs
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
                      {p.address && (
                        <p className="text-xs text-text-muted truncate">{p.address}</p>
                      )}
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

          {/* ── Empty state ─────────────────────────────────────────────── */}
          {activeBidProjects.length === 0 && readyProjects.length === 0 && !loading && (
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
