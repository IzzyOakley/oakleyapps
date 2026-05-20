'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, Loader2, Download, CheckCircle, AlertTriangle,
  X, ArrowRight, FileText, Sparkles, Plus,
} from 'lucide-react'
import {
  getProjectBids, getProjectBidSetup, generateBids, approveBid, downloadBidPdf,
} from '@/lib/vendy/bids-api'
import type { Bid, BidSetup, BidSetupCostCode } from '@/lib/vendy/bids-api'

interface Props { projectId: string }

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}
function fmtDecimal(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function initials(name: string) {
  return name.split(/[\s_]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}

// ── Status dot ────────────────────────────────────────────────────────────────

function StatusDot({ status }: { status: Bid['status'] }) {
  const map: Record<string, { dot: string; label: string; text: string }> = {
    generating:   { dot: 'bg-primary animate-pulse', label: 'Generating…', text: 'text-primary' },
    needs_review: { dot: 'bg-warning',                label: 'In review',   text: 'text-warning' },
    approved:     { dot: 'bg-success',                label: 'Approved',    text: 'text-success' },
    sent:         { dot: 'bg-info',                   label: 'Sent',        text: 'text-info' },
    confirmed:    { dot: 'bg-info',                   label: 'Confirmed',   text: 'text-info' },
    revised:      { dot: 'bg-info',                   label: 'Revised',     text: 'text-info' },
    awarded:      { dot: 'bg-success',                label: 'Awarded',     text: 'text-success' },
    not_awarded:  { dot: 'bg-text-muted',             label: 'Not awarded', text: 'text-text-muted' },
    failed:       { dot: 'bg-danger',                 label: 'Failed',      text: 'text-danger' },
  }
  const s = map[status] ?? { dot: 'bg-text-muted', label: status, text: 'text-text-muted' }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
      <span className={`text-[11px] font-medium ${s.text}`}>{s.label}</span>
    </span>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProjectBidsClient({ projectId }: Props) {
  const router = useRouter()
  const [bids, setBids] = useState<Bid[]>([])
  const [setup, setSetup] = useState<BidSetup | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadBids = useCallback(async () => {
    try { setBids(await getProjectBids(projectId)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load bids') }
  }, [projectId])

  useEffect(() => {
    async function init() {
      await loadBids()
      try { setSetup(await getProjectBidSetup(projectId)) } catch { /* no takeoff */ }
      setLoading(false)
    }
    init()
  }, [projectId, loadBids])

  useEffect(() => {
    const hasGenerating = bids.some(b => b.status === 'generating')
    if (hasGenerating) {
      pollRef.current = setInterval(loadBids, 3000)
      return () => { if (pollRef.current) clearInterval(pollRef.current) }
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [bids, loadBids])

  const hasBids = bids.length > 0
  const projectName = setup?.project_name ?? bids[0]?.project_name ?? projectId

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="animate-in fade-in pb-20">
      {/* Back */}
      <button
        onClick={() => router.push('/vendy/bids')}
        className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors mb-5"
      >
        <ChevronLeft size={14} />
        Bids
      </button>

      {/* Page header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-text-primary tracking-tight">{projectName}</h1>
          {hasBids && (
            <p className="text-[11px] text-text-muted mt-0.5">
              {bids.length} bid{bids.length !== 1 ? 's' : ''} across{' '}
              {new Set(bids.map(b => b.cost_code)).size} cost codes ·{' '}
              <span className="text-primary font-medium">
                {bids.filter(b => b.status === 'approved').length}/{bids.length} approved
              </span>
            </p>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-danger-bg border border-danger/20 rounded-lg mb-5 text-xs text-danger">
          <AlertTriangle size={13} />
          {error}
        </div>
      )}

      {hasBids ? (
        <BidsMatrix
          bids={bids}
          projectId={projectId}
          onBidApproved={loadBids}
          onError={setError}
          onNavigate={(bidId) => router.push(`/vendy/bids/${projectId}/${bidId}`)}
        />
      ) : (
        <VendorSetup
          setup={setup}
          projectId={projectId}
          onGenerated={loadBids}
          onError={setError}
        />
      )}
    </div>
  )
}

// ── Phase A: Vendor selection + generate ──────────────────────────────────────

function VendorSetup({
  setup, projectId, onGenerated, onError,
}: {
  setup: BidSetup | null
  projectId: string
  onGenerated: () => void
  onError: (msg: string) => void
}) {
  const [selection, setSelection] = useState<Record<string, Set<string>>>({})
  const [showModal, setShowModal] = useState(false)
  const [generating, setGenerating] = useState(false)
  const router = useRouter()

  useEffect(() => {
    if (!setup) return
    const initial: Record<string, Set<string>> = {}
    for (const cc of setup.cost_codes) {
      initial[cc.cost_code] = new Set(cc.vendors.map(v => v.vendor_id))
    }
    setSelection(initial)
  }, [setup])

  function toggleVendor(costCode: string, vendorId: string) {
    setSelection(prev => {
      const set = new Set(prev[costCode] ?? [])
      if (set.has(vendorId)) set.delete(vendorId)
      else set.add(vendorId)
      return { ...prev, [costCode]: set }
    })
  }

  const totalVendors = Object.values(selection).reduce((n, s) => n + s.size, 0)
  const totalCodes = Object.values(selection).filter(s => s.size > 0).length

  async function handleConfirm() {
    setGenerating(true)
    try {
      const sel: Record<string, string[]> = {}
      for (const [code, set] of Object.entries(selection)) {
        if (set.size > 0) sel[code] = Array.from(set)
      }
      await generateBids(projectId, sel)
      setShowModal(false)
      onGenerated()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Generation failed')
      setGenerating(false)
      setShowModal(false)
    }
  }

  if (!setup) {
    return (
      <div className="bg-surface border border-border rounded-[14px] p-12 text-center">
        <AlertTriangle size={18} className="text-text-muted mx-auto mb-3" />
        <p className="text-sm font-medium text-text-primary mb-1">No approved takeoff found</p>
        <p className="text-xs text-text-muted mb-4">Approve a takeoff for this project first.</p>
        <button
          onClick={() => router.push(`/vendy/takeoffs/${projectId}`)}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium border border-border text-text-secondary rounded-md hover:border-primary/40 transition-colors"
        >
          Go to Takeoffs <ArrowRight size={12} />
        </button>
      </div>
    )
  }

  return (
    <>
      {/* Intro */}
      <div className="flex items-center gap-4 px-5 py-4 bg-surface border border-border rounded-[14px] mb-5">
        <div className="w-8 h-8 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
          <Sparkles size={14} className="text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-primary">Select vendors for each cost code</p>
          <p className="text-xs text-text-muted mt-0.5">
            Claude generates a tailored bid for each vendor using their pricing history. Remove vendors to exclude.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          disabled={totalVendors === 0}
          className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold bg-primary text-white rounded-md hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          <Sparkles size={12} /> Generate Bids
        </button>
      </div>

      <div className="space-y-3">
        {setup.cost_codes.map(cc => (
          <CostCodeVendorRow
            key={cc.cost_code}
            cc={cc}
            selected={selection[cc.cost_code] ?? new Set()}
            onToggle={(vid) => toggleVendor(cc.cost_code, vid)}
          />
        ))}
      </div>

      {/* Sticky footer */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-surface/95 backdrop-blur px-6 py-3 flex items-center justify-between z-40">
        <p className="text-xs text-text-muted">
          {totalVendors === 0
            ? <span className="text-warning">Select at least one vendor to continue</span>
            : <><span className="font-semibold text-text-primary">{totalVendors}</span> vendor{totalVendors !== 1 ? 's' : ''} across <span className="font-semibold text-text-primary">{totalCodes}</span> cost code{totalCodes !== 1 ? 's' : ''}</>}
        </p>
        <button
          onClick={() => setShowModal(true)}
          disabled={totalVendors === 0}
          className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold bg-primary text-white rounded-md hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Sparkles size={12} /> Generate Bids
        </button>
      </div>

      {showModal && (
        <ConfirmModal
          totalVendors={totalVendors}
          totalCodes={totalCodes}
          generating={generating}
          onConfirm={handleConfirm}
          onCancel={() => setShowModal(false)}
        />
      )}
    </>
  )
}

function CostCodeVendorRow({
  cc, selected, onToggle,
}: {
  cc: BidSetupCostCode
  selected: Set<string>
  onToggle: (vendorId: string) => void
}) {
  return (
    <div className="bg-surface border border-border rounded-[14px] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-primary">{cc.cost_code_name}</span>
          <span className="px-1.5 py-0.5 rounded bg-primary-light text-primary-mid text-[10px] font-medium">{cc.cost_code}</span>
          <span className="text-[11px] text-text-muted">{cc.vendors.length} vendor{cc.vendors.length !== 1 ? 's' : ''}</span>
        </div>
        <span className={`text-[11px] font-medium ${selected.size === 0 ? 'text-text-muted' : 'text-text-secondary'}`}>
          {selected.size} of {cc.vendors.length} selected
        </span>
      </div>
      <div className="px-5 py-3 flex flex-wrap gap-2">
        {cc.vendors.map(v => {
          const isSelected = selected.has(v.vendor_id)
          return (
            <button
              key={v.vendor_id}
              onClick={() => onToggle(v.vendor_id)}
              className={`inline-flex items-center gap-1.5 h-7 pl-2.5 pr-2 rounded-full text-[11px] font-medium transition-all ${
                isSelected
                  ? 'bg-primary-light text-primary border border-primary/20 hover:bg-primary/10'
                  : 'bg-surface-raised text-text-muted border border-border hover:border-border-bright'
              }`}
            >
              {v.vendor_name.replace(/_/g, ' ')}
              {isSelected && <X size={9} />}
            </button>
          )
        })}
        {cc.vendors.length === 0 && (
          <p className="text-[11px] text-text-muted italic">No vendors with pricing for this code</p>
        )}
      </div>
    </div>
  )
}

// ── Phase B: Bids matrix ──────────────────────────────────────────────────────

function BidsMatrix({
  bids, projectId, onBidApproved, onError, onNavigate,
}: {
  bids: Bid[]
  projectId: string
  onBidApproved: () => void
  onError: (msg: string) => void
  onNavigate: (bidId: string) => void
}) {
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set())
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set())

  const grouped = new Map<string, { name: string; bids: Bid[] }>()
  for (const bid of bids) {
    const existing = grouped.get(bid.cost_code)
    if (existing) existing.bids.push(bid)
    else grouped.set(bid.cost_code, { name: bid.cost_code_name, bids: [bid] })
  }

  async function handleApprove(bid: Bid) {
    setApprovingIds(prev => new Set(prev).add(bid.bid_id))
    try {
      await approveBid(bid.bid_id)
      await onBidApproved()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Approval failed')
    } finally {
      setApprovingIds(prev => { const n = new Set(prev); n.delete(bid.bid_id); return n })
    }
  }

  async function handleDownload(bid: Bid) {
    setDownloadingIds(prev => new Set(prev).add(bid.bid_id))
    try {
      const filename = `bid_${bid.project_name}_${bid.vendor_name}_v${bid.version ?? 1}.pdf`
        .replace(/\s+/g, '_').toLowerCase()
      await downloadBidPdf(bid.bid_id, filename)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to download PDF')
    } finally {
      setDownloadingIds(prev => { const n = new Set(prev); n.delete(bid.bid_id); return n })
    }
  }

  return (
    <div className="space-y-3">
      {Array.from(grouped.entries()).map(([costCode, { name, bids: codeBids }]) => (
        <div key={costCode} className="bg-surface border border-border rounded-[14px] overflow-hidden">
          {/* Cost code header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-border-light">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-semibold text-primary">{name}</span>
              <span className="px-1.5 py-0.5 rounded bg-primary-light text-primary-mid text-[10px] font-medium">{costCode}</span>
              <span className="text-[11px] text-text-muted">{codeBids.length} vendor{codeBids.length !== 1 ? 's' : ''}</span>
            </div>
            <button className="text-[11px] font-medium text-primary hover:text-primary/70 transition-colors">
              + Add vendor
            </button>
          </div>

          {/* Vendor rows — strict 4-column grid */}
          <div className="divide-y divide-border-light">
            {codeBids.map(bid => {
              const isGenerating = bid.status === 'generating'
              const canApprove = bid.status === 'needs_review'
              return (
                <div
                  key={bid.bid_id}
                  className={`grid items-center px-5 py-3 transition-colors ${isGenerating ? 'opacity-50' : 'hover:bg-surface-raised/60'}`}
                  style={{ gridTemplateColumns: 'minmax(0,1fr) 88px 72px 112px' }}
                >
                  {/* Vendor name */}
                  <div className="min-w-0 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-md bg-primary-light flex items-center justify-center shrink-0">
                        <span className="text-[10px] font-bold text-primary">{initials(bid.vendor_name)}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-text-primary truncate">
                          {bid.vendor_name.replace(/_/g, ' ')}
                        </p>
                        {bid.generated_at && (
                          <p className="text-[10px] text-text-muted">
                            {isGenerating ? 'Generating…' : `Generated ${new Date(bid.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Status */}
                  <div>
                    <StatusDot status={bid.status} />
                  </div>

                  {/* Total */}
                  <div className="text-right">
                    {isGenerating ? (
                      <span className="text-[12px] font-mono text-primary-mid">—</span>
                    ) : bid.subtotal != null ? (
                      <span className="text-[12px] font-mono font-medium text-text-primary">
                        ${fmt(bid.subtotal)}
                      </span>
                    ) : (
                      <span className="text-[12px] font-mono text-text-muted">—</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center justify-end gap-1.5">
                    {!isGenerating && (
                      <button
                        onClick={() => onNavigate(bid.bid_id)}
                        className="h-7 px-2.5 text-[11px] font-medium border border-border text-text-secondary rounded-md hover:border-border-bright hover:text-text-primary transition-colors"
                      >
                        View
                      </button>
                    )}
                    {canApprove && (
                      <button
                        onClick={() => handleApprove(bid)}
                        disabled={approvingIds.has(bid.bid_id)}
                        className="h-7 px-2.5 text-[11px] font-semibold bg-primary text-white rounded-md hover:bg-primary-hover transition-colors disabled:opacity-50 flex items-center gap-1"
                      >
                        {approvingIds.has(bid.bid_id) ? <Loader2 size={10} className="animate-spin" /> : null}
                        Approve
                      </button>
                    )}
                    {(bid.status === 'needs_review' || bid.status === 'approved') && (
                      <button
                        onClick={() => handleDownload(bid)}
                        disabled={downloadingIds.has(bid.bid_id)}
                        title="Download PDF"
                        className="h-7 w-7 flex items-center justify-center border border-border text-text-muted rounded-md hover:border-border-bright hover:text-text-secondary transition-colors disabled:opacity-50"
                      >
                        {downloadingIds.has(bid.bid_id)
                          ? <Loader2 size={11} className="animate-spin" />
                          : <Download size={11} />}
                      </button>
                    )}
                    {bid.status === 'approved' && (
                      <CheckCircle size={14} className="text-success ml-0.5" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Confirm modal ─────────────────────────────────────────────────────────────

function ConfirmModal({
  totalVendors, totalCodes, generating, onConfirm, onCancel,
}: {
  totalVendors: number
  totalCodes: number
  generating: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => !generating && onCancel()} />
      <div className="relative bg-surface border border-border rounded-[14px] shadow-card w-full max-w-sm p-6 animate-in fade-in">
        <div className="w-10 h-10 rounded-xl bg-primary-light flex items-center justify-center mb-4">
          <FileText size={16} className="text-primary" />
        </div>
        <h2 className="text-[15px] font-semibold text-text-primary mb-1.5">Generate bid documents</h2>
        <p className="text-xs text-text-muted mb-4 leading-relaxed">
          Claude will generate a tailored bid for each vendor — {' '}
          <span className="font-medium text-text-primary">{totalVendors} document{totalVendors !== 1 ? 's' : ''}</span> across{' '}
          <span className="font-medium text-text-primary">{totalCodes} cost code{totalCodes !== 1 ? 's' : ''}</span>.
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={onCancel}
            disabled={generating}
            className="flex-1 h-8 text-xs font-medium border border-border text-text-secondary rounded-md hover:border-border-bright transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={generating}
            className="flex-1 h-8 text-xs font-semibold bg-primary text-white rounded-md hover:bg-primary-hover transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
          >
            {generating ? <><Loader2 size={12} className="animate-spin" /> Starting…</> : <><Sparkles size={12} /> Generate</>}
          </button>
        </div>
      </div>
    </div>
  )
}
