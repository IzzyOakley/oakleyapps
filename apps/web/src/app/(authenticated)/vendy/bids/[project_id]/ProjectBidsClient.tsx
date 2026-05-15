'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, Loader2, Download, CheckCircle, AlertTriangle,
  X, Users, ArrowRight, ChevronRight, FileText,
} from 'lucide-react'
import {
  getProjectBids, getProjectBidSetup, generateBids, approveBid, downloadBidPdf,
} from '@/lib/vendy/bids-api'
import type { Bid, BidSetup, BidSetupCostCode } from '@/lib/vendy/bids-api'

interface Props { projectId: string }

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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
    try {
      const data = await getProjectBids(projectId)
      setBids(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bids')
    }
  }, [projectId])

  useEffect(() => {
    async function init() {
      await loadBids()
      // Always fetch setup so we know the project name + cost codes
      try {
        const s = await getProjectBidSetup(projectId)
        setSetup(s)
      } catch { /* service offline or no takeoff — handle gracefully */ }
      setLoading(false)
    }
    init()
  }, [projectId, loadBids])

  // Poll every 3 s while any bid is generating
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
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  return (
    <div className="animate-in fade-in pb-20">
      {/* Back */}
      <button
        onClick={() => router.push('/vendy/bids')}
        className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors mb-6"
      >
        <ChevronLeft size={16} />
        Bids
      </button>

      {/* Project header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-text-primary tracking-tight">{projectName}</h1>
        {bids[0]?.project_name && setup?.project_name !== bids[0]?.project_name && (
          <p className="text-sm text-text-muted mt-0.5">{bids[0]?.project_name}</p>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-error/10 border border-error/20 rounded-xl mb-6 text-sm text-error">
          <AlertTriangle size={15} />
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
  setup,
  projectId,
  onGenerated,
  onError,
}: {
  setup: BidSetup | null
  projectId: string
  onGenerated: () => void
  onError: (msg: string) => void
}) {
  // selection: { cost_code: Set<vendor_id> }
  const [selection, setSelection] = useState<Record<string, Set<string>>>({})
  const [showModal, setShowModal] = useState(false)
  const [generating, setGenerating] = useState(false)
  const router = useRouter()

  // Initialise selection to all vendors when setup loads
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
      // Build selection map (only include codes with ≥1 vendor selected)
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
      <div className="bg-surface border border-border rounded-2xl p-12 text-center">
        <div className="w-12 h-12 rounded-2xl bg-surface-raised flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={20} className="text-text-muted" />
        </div>
        <p className="text-sm font-medium text-text-primary mb-1">No approved takeoff found</p>
        <p className="text-xs text-text-muted mb-4">
          Approve a takeoff for this project before generating bids.
        </p>
        <button
          onClick={() => router.push(`/vendy/takeoffs/${projectId}`)}
          className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium border border-border text-text-secondary rounded-lg hover:border-border-bright transition-colors"
        >
          Go to Takeoffs
          <ChevronRight size={14} />
        </button>
      </div>
    )
  }

  return (
    <>
      {/* Intro card */}
      <div className="flex items-start gap-4 px-5 py-4 bg-surface border border-border rounded-2xl mb-6">
        <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
          <Users size={16} className="text-primary" />
        </div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-primary">Select vendors for each cost code</p>
          <p className="text-xs text-text-muted mt-0.5">
            Claude will generate a tailored bid for each selected vendor using their pricing history.
            Remove any vendors you don&apos;t want to include.
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          disabled={totalVendors === 0}
          className="inline-flex items-center gap-2 h-10 px-5 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          Generate Bids
          <ArrowRight size={15} />
        </button>
      </div>

      {/* Cost code list */}
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
      <div className="fixed bottom-0 left-0 right-0 border-t border-border bg-surface/90 backdrop-blur px-6 py-4 flex items-center justify-between z-40">
        <p className="text-sm text-text-muted">
          {totalVendors === 0 ? (
            <span className="text-warning">Select at least one vendor to continue</span>
          ) : (
            <>
              <span className="font-semibold text-text-primary">{totalVendors}</span> vendor{totalVendors !== 1 ? 's' : ''} across{' '}
              <span className="font-semibold text-text-primary">{totalCodes}</span> cost code{totalCodes !== 1 ? 's' : ''}
            </>
          )}
        </p>
        <button
          onClick={() => setShowModal(true)}
          disabled={totalVendors === 0}
          className="inline-flex items-center gap-2 h-10 px-6 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Generate Bids
          <ArrowRight size={15} />
        </button>
      </div>

      {/* Confirmation modal */}
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
  cc,
  selected,
  onToggle,
}: {
  cc: BidSetupCostCode
  selected: Set<string>
  onToggle: (vendorId: string) => void
}) {
  const selectedCount = selected.size
  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-surface-raised/50">
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {cc.cost_code} — {cc.cost_code_name}
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            {cc.takeoff_item_count} takeoff item{cc.takeoff_item_count !== 1 ? 's' : ''}
          </p>
        </div>
        <span className={`text-xs font-medium tabular-nums ${selectedCount === 0 ? 'text-text-muted' : 'text-text-secondary'}`}>
          {selectedCount} of {cc.vendors.length} selected
        </span>
      </div>

      {/* Vendor chips */}
      <div className="px-5 py-4 flex flex-wrap gap-2">
        {cc.vendors.map(v => {
          const isSelected = selected.has(v.vendor_id)
          return (
            <button
              key={v.vendor_id}
              onClick={() => onToggle(v.vendor_id)}
              title={v.line_item_count > 0 ? `${v.line_item_count} pricing line items` : 'No historical pricing'}
              className={`inline-flex items-center gap-1.5 h-8 pl-3 pr-2 rounded-full text-xs font-medium transition-all duration-150 ${
                isSelected
                  ? 'bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25'
                  : 'bg-surface-raised text-text-muted border border-border hover:border-border-bright'
              }`}
            >
              {v.vendor_name}
              {isSelected && (
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-primary/20 hover:bg-primary/40 transition-colors">
                  <X size={9} />
                </span>
              )}
            </button>
          )
        })}
        {cc.vendors.length === 0 && (
          <p className="text-xs text-text-muted italic">No vendors with pricing history for this code</p>
        )}
      </div>
    </div>
  )
}

function ConfirmModal({
  totalVendors,
  totalCodes,
  generating,
  onConfirm,
  onCancel,
}: {
  totalVendors: number
  totalCodes: number
  generating: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => !generating && onCancel()}
      />
      {/* Modal */}
      <div className="relative bg-surface border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-in fade-in slide-in-from-bottom-4">
        <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-5">
          <FileText size={20} className="text-primary" />
        </div>
        <h2 className="text-lg font-semibold text-text-primary mb-2">Generate bid documents</h2>
        <p className="text-sm text-text-muted mb-5 leading-relaxed">
          Claude will generate a tailored bid for each vendor. This creates{' '}
          <span className="font-semibold text-text-primary">{totalVendors} bid document{totalVendors !== 1 ? 's' : ''}</span> across{' '}
          <span className="font-semibold text-text-primary">{totalCodes} cost code{totalCodes !== 1 ? 's' : ''}</span>.
          Each bid uses that vendor&apos;s historical pricing and the approved takeoff quantities.
        </p>

        <div className="flex items-center gap-2 px-3 py-2.5 bg-surface-raised rounded-xl mb-6">
          <Loader2 size={12} className="text-text-muted shrink-0" />
          <p className="text-xs text-text-muted">Takes approximately {Math.ceil(totalVendors * 15 / 60)} – {Math.ceil(totalVendors * 30 / 60)} minutes</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            disabled={generating}
            className="flex-1 h-10 text-sm font-medium border border-border text-text-secondary rounded-xl hover:border-border-bright transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={generating}
            className="flex-1 h-10 text-sm font-semibold bg-primary text-white rounded-xl hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {generating ? (
              <><Loader2 size={14} className="animate-spin" /> Starting…</>
            ) : (
              <>Generate Bids <ArrowRight size={14} /></>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Phase B: Bids matrix ──────────────────────────────────────────────────────

function BidsMatrix({
  bids,
  projectId,
  onBidApproved,
  onError,
  onNavigate,
}: {
  bids: Bid[]
  projectId: string
  onBidApproved: () => void
  onError: (msg: string) => void
  onNavigate: (bidId: string) => void
}) {
  const [approvingIds, setApprovingIds] = useState<Set<string>>(new Set())
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set())

  // Group bids by cost_code, preserving insertion order
  const grouped = new Map<string, { name: string; bids: Bid[] }>()
  for (const bid of bids) {
    const existing = grouped.get(bid.cost_code)
    if (existing) existing.bids.push(bid)
    else grouped.set(bid.cost_code, { name: bid.cost_code_name, bids: [bid] })
  }

  const approvedCount = bids.filter(b => b.status === 'approved').length
  const totalSubtotal = bids.reduce((s, b) => s + (b.subtotal ?? 0), 0)
  const anyGenerating = bids.some(b => b.status === 'generating')

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
      {/* Summary bar */}
      <div className="flex items-center gap-6 px-5 py-4 bg-surface border border-border rounded-2xl">
        <div>
          <p className="text-xs text-text-muted">Total bid value</p>
          <p className="text-lg font-semibold text-text-primary tabular-nums">${fmt(totalSubtotal)}</p>
        </div>
        <div className="h-8 w-px bg-border" />
        <div>
          <p className="text-xs text-text-muted">Approved</p>
          <p className="text-base font-semibold text-text-primary">{approvedCount} / {bids.length}</p>
        </div>
        {anyGenerating && (
          <>
            <div className="h-8 w-px bg-border" />
            <div className="flex items-center gap-1.5 text-primary">
              <Loader2 size={13} className="animate-spin" />
              <p className="text-xs font-medium">Generating… auto-refreshing</p>
            </div>
          </>
        )}
      </div>

      {/* Cost code sections */}
      {Array.from(grouped.entries()).map(([costCode, { name, bids: codeBids }]) => {
        const codeApproved = codeBids.filter(b => b.status === 'approved').length
        const codeTotal = codeBids.reduce((s, b) => s + (b.subtotal ?? 0), 0)

        return (
          <div key={costCode} className="bg-surface border border-border rounded-2xl overflow-hidden">
            {/* Cost code header */}
            <div className="flex items-center justify-between px-5 py-4 bg-surface-raised/50 border-b border-border">
              <div>
                <p className="text-sm font-semibold text-text-primary">{costCode} — {name}</p>
                <p className="text-xs text-text-muted mt-0.5">
                  {codeBids.length} vendor{codeBids.length !== 1 ? 's' : ''} · {codeApproved} approved
                </p>
              </div>
              {codeTotal > 0 && (
                <p className="text-sm font-semibold text-text-primary tabular-nums">${fmt(codeTotal)}</p>
              )}
            </div>

            {/* Vendor rows */}
            <div className="divide-y divide-border">
              {codeBids.map(bid => (
                <div
                  key={bid.bid_id}
                  className="flex items-center gap-4 px-5 py-4 hover:bg-surface-raised/30 transition-colors"
                >
                  {/* Vendor name + subtotal */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-text-primary">{bid.vendor_name}</p>
                    {bid.subtotal != null && bid.status !== 'generating' && (
                      <p className="text-xs tabular-nums text-text-muted mt-0.5">
                        ${fmt(bid.subtotal)}
                      </p>
                    )}
                  </div>

                  {/* Status badge */}
                  <BidStatusBadge status={bid.status} />

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {/* View */}
                    {bid.status !== 'generating' && (
                      <button
                        onClick={() => onNavigate(bid.bid_id)}
                        className="h-8 px-3 text-xs font-medium border border-border text-text-secondary rounded-lg hover:border-border-bright hover:text-text-primary transition-colors"
                      >
                        View
                      </button>
                    )}

                    {/* Approve */}
                    {bid.status === 'needs_review' && (
                      <button
                        onClick={() => handleApprove(bid)}
                        disabled={approvingIds.has(bid.bid_id)}
                        className="h-8 px-3 text-xs font-medium bg-success/15 text-success rounded-lg hover:bg-success/25 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      >
                        {approvingIds.has(bid.bid_id)
                          ? <Loader2 size={11} className="animate-spin" />
                          : <CheckCircle size={11} />}
                        Approve
                      </button>
                    )}

                    {/* Download PDF */}
                    {(bid.status === 'needs_review' || bid.status === 'approved') && (
                      <button
                        onClick={() => handleDownload(bid)}
                        disabled={downloadingIds.has(bid.bid_id)}
                        title="Download PDF"
                        className="h-8 w-8 flex items-center justify-center border border-border text-text-muted rounded-lg hover:border-border-bright hover:text-text-secondary transition-colors disabled:opacity-50"
                      >
                        {downloadingIds.has(bid.bid_id)
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Download size={13} />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function BidStatusBadge({ status }: { status: Bid['status'] }) {
  if (status === 'generating') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-primary/15 text-primary animate-pulse shrink-0">
        <Loader2 size={10} className="animate-spin" />
        Generating…
      </span>
    )
  }
  if (status === 'needs_review') {
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-warning/15 text-warning shrink-0">
        Needs Review
      </span>
    )
  }
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-success/15 text-success shrink-0">
        <CheckCircle size={10} />
        Approved
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-error/15 text-error shrink-0">
        <AlertTriangle size={10} />
        Failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-surface-raised text-text-muted shrink-0">
      {status}
    </span>
  )
}
