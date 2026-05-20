'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, Loader2, CheckCircle, Download,
  Edit2, AlertTriangle, X, Check, Sparkles,
} from 'lucide-react'
import { getBidDetail, updateBidLineItem, approveBidDocument } from '@/lib/vendy/api'
import { downloadBidPdf } from '@/lib/vendy/bids-api'
import type { BidDocument, BidLineItem, BidLineItemSource } from '@/lib/vendy/types'

interface Props { projectId: string; bidId: string }

function initials(name: string) {
  return name.split(/[\s_]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}
function vendorLabel(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function isEstimated(s: BidLineItemSource) {
  return s === 'generated' || s === 'estimated'
}

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: BidLineItemSource }) {
  if (source === 'history') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary-light text-primary">
        Takeoff
      </span>
    )
  }
  if (source === 'legacy') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-raised text-text-muted border border-border">
        Legacy
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-warning-bg text-warning">
      Estimated
    </span>
  )
}

// ── Status inline text ────────────────────────────────────────────────────────

function StatusText({ status }: { status: BidDocument['status'] }) {
  const map: Record<string, { label: string; cls: string }> = {
    generating:   { label: 'Generating…', cls: 'text-primary' },
    needs_review: { label: 'In review',   cls: 'text-warning' },
    approved:     { label: 'Approved',    cls: 'text-success' },
    sent:         { label: 'Sent',        cls: 'text-info' },
    confirmed:    { label: 'Confirmed',   cls: 'text-info' },
    revised:      { label: 'Revised',     cls: 'text-info' },
    awarded:      { label: 'Awarded',     cls: 'text-success' },
    not_awarded:  { label: 'Not awarded', cls: 'text-text-muted' },
    failed:       { label: 'Failed',      cls: 'text-danger' },
  }
  const s = map[status] ?? { label: status, cls: 'text-text-muted' }
  return <span className={`text-[13px] font-semibold ${s.cls}`}>{s.label}</span>
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BidReviewClient({ projectId, bidId }: Props) {
  const router = useRouter()
  const [bid, setBid] = useState<BidDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [reviewedIdxs, setReviewedIdxs] = useState<Set<number>>(new Set())
  const [flagsDismissed, setFlagsDismissed] = useState(false)

  const loadBid = useCallback(async () => {
    try {
      const data = await getBidDetail(bidId)
      setBid(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bid')
    } finally {
      setLoading(false)
    }
  }, [bidId])

  useEffect(() => { loadBid() }, [loadBid])

  const estimatedIdxs = bid
    ? bid.line_items.reduce<number[]>((acc, item, i) => {
        if (isEstimated(item.source)) acc.push(i)
        return acc
      }, [])
    : []
  const allReviewed = estimatedIdxs.every(i => reviewedIdxs.has(i))
  const unreviewedCount = estimatedIdxs.filter(i => !reviewedIdxs.has(i)).length

  const historyCount = bid ? bid.line_items.filter(i => i.source === 'history').length : 0

  function openEdit(idx: number) {
    setEditingIdx(idx)
    if (bid && isEstimated(bid.line_items[idx].source)) {
      setReviewedIdxs(prev => new Set(prev).add(idx))
    }
  }

  async function handleApprove() {
    setApproving(true)
    setError(null)
    try {
      await approveBidDocument(bidId)
      router.push(`/vendy/bids/${projectId}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Approval failed')
      setApproving(false)
    }
  }

  async function handleDownload() {
    if (!bid) return
    setDownloading(true)
    setError(null)
    try {
      const filename = `bid_${bid.project_name}_${bid.vendor_name}_v${bid.version ?? 1}.pdf`
        .replace(/\s+/g, '_').toLowerCase()
      await downloadBidPdf(bidId, filename)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed')
    } finally {
      setDownloading(false)
    }
  }

  function handleLineItemSaved(idx: number, updated: BidLineItem) {
    if (!bid) return
    const items = bid.line_items.map((item, i) => i === idx ? updated : item)
    const subtotal = items.reduce((sum, item) => sum + (item.total ?? 0), 0)
    setBid({ ...bid, line_items: items, subtotal })
    setEditingIdx(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={20} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (!bid) {
    return <div className="text-danger text-sm mt-8">{error ?? 'Bid not found.'}</div>
  }

  const canApprove = bid.status === 'needs_review' && allReviewed
  const flagText = bid.generation_notes
  const hasFlags = !!flagText && !flagsDismissed

  return (
    <div className="animate-in fade-in pb-16 max-w-5xl">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1 text-[11px] mb-5">
        <button
          onClick={() => router.push('/vendy/bids')}
          className="text-primary hover:text-primary/70 transition-colors"
        >
          Bids
        </button>
        <ChevronRight size={11} className="text-text-muted" />
        <button
          onClick={() => router.push(`/vendy/bids/${projectId}`)}
          className="text-primary hover:text-primary/70 transition-colors"
        >
          {bid.project_name}
        </button>
        <ChevronRight size={11} className="text-text-muted" />
        <span className="text-text-muted">{vendorLabel(bid.vendor_name)} — {bid.cost_code_name}</span>
      </nav>

      {/* Vendor header card */}
      <div className="bg-surface border border-border rounded-[14px] px-6 py-5 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 rounded-lg bg-primary-light flex items-center justify-center shrink-0">
              <span className="text-[13px] font-bold text-primary">{initials(bid.vendor_name)}</span>
            </div>
            <div>
              <h1 className="text-[17px] font-semibold text-text-primary leading-tight">
                {vendorLabel(bid.vendor_name)}
              </h1>
              <p className="text-[11px] text-text-muted mt-0.5">
                {bid.cost_code_name} · {bid.cost_code}
                {bid.generated_at && (
                  <> · Submitted {new Date(bid.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="h-8 w-8 flex items-center justify-center border border-border text-text-muted rounded-md hover:border-border-bright hover:text-text-secondary transition-colors disabled:opacity-50"
              title="Download PDF"
            >
              {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            </button>
            <button
              onClick={handleApprove}
              disabled={!canApprove || approving}
              title={
                bid.status !== 'needs_review'
                  ? undefined
                  : !allReviewed
                  ? `Review ${unreviewedCount} estimated item${unreviewedCount !== 1 ? 's' : ''} first`
                  : undefined
              }
              className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold bg-primary text-white rounded-md hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {approving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
              Approve bid
            </button>
          </div>
        </div>

        {/* 4-column meta strip */}
        <div className="grid grid-cols-4 gap-4 mt-5 pt-4 border-t border-border-light">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted mb-0.5">Total bid</p>
            <p className="text-[13px] font-semibold text-primary tabular-nums">
              {bid.subtotal != null ? `$${fmt(bid.subtotal)}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted mb-0.5">Status</p>
            <StatusText status={bid.status} />
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted mb-0.5">Line items</p>
            <p className="text-[13px] font-semibold text-text-primary">{bid.line_items.length}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted mb-0.5">History matched</p>
            <p className="text-[13px] font-semibold text-success">
              {historyCount} / {bid.line_items.length} matched
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-3 py-2.5 bg-danger-bg border border-danger/20 rounded-lg mb-4 text-xs text-danger">
          <AlertTriangle size={12} />
          {error}
        </div>
      )}

      {/* AI review card */}
      {hasFlags && (
        <AIReviewCard
          notes={flagText}
          unreviewedCount={unreviewedCount}
          onDismiss={() => setFlagsDismissed(true)}
        />
      )}

      {/* Line items table */}
      <div className="bg-surface border border-border rounded-[14px] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border-light">
          <p className="text-[12px] font-semibold text-text-primary">
            Line items <span className="text-text-muted font-normal">{bid.line_items.length} items</span>
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-light bg-surface-raised">
                <th className="text-left px-5 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">Description</th>
                <th className="text-right px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted w-16">Qty</th>
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted w-14">Unit</th>
                <th className="text-right px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted w-24">Unit Price</th>
                <th className="text-right px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted w-24">Total</th>
                <th className="text-left px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted w-20">Source</th>
                <th className="px-3 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {bid.line_items.map((item, idx) => (
                editingIdx === idx ? (
                  <EditRow
                    key={idx}
                    item={item}
                    idx={idx}
                    bidId={bidId}
                    onSaved={(updated) => handleLineItemSaved(idx, updated)}
                    onCancel={() => setEditingIdx(null)}
                  />
                ) : (
                  <tr
                    key={idx}
                    className={`border-t border-border-light transition-colors ${
                      isEstimated(item.source) && !reviewedIdxs.has(idx)
                        ? 'bg-warning-bg/40 hover:bg-warning-bg/70'
                        : 'hover:bg-surface-raised/50'
                    }`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11.5px] text-text-primary">{item.description}</span>
                        {isEstimated(item.source) && !reviewedIdxs.has(idx) && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold bg-warning-bg text-warning border border-warning/20">
                            AI flag
                          </span>
                        )}
                      </div>
                      {item.notes && (
                        <p className="text-[10px] text-text-muted mt-0.5 leading-relaxed line-clamp-2">{item.notes}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="text-[11.5px] font-mono text-text-primary tabular-nums">
                        {item.quantity != null ? item.quantity.toLocaleString() : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className="text-[11.5px] text-text-secondary">{item.unit}</span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="text-[11.5px] font-mono text-text-primary tabular-nums">
                        {item.unit_price != null ? `$${fmt(item.unit_price)}` : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className={`text-[11.5px] font-mono tabular-nums font-medium ${isEstimated(item.source) ? 'text-warning' : 'text-text-primary'}`}>
                        {item.total != null ? `$${fmt(item.total)}` : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <SourceBadge source={item.source} />
                    </td>
                    <td className="px-3 py-3">
                      {bid.status !== 'approved' && (
                        <button
                          onClick={() => openEdit(idx)}
                          className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-surface-raised transition-colors"
                          title="Edit"
                        >
                          <Edit2 size={11} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-surface-raised">
                <td colSpan={4} className="px-5 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                  Subtotal
                </td>
                <td className="px-3 py-3 text-right">
                  <span className="text-[13px] font-mono font-semibold text-text-primary tabular-nums">
                    {bid.subtotal != null ? `$${fmt(bid.subtotal)}` : '—'}
                  </span>
                </td>
                <td />
                <td className="px-3 py-3 text-right">
                  <span className="text-[10px] font-semibold text-primary tabular-nums">
                    {bid.subtotal != null ? `Bid total $${fmt(bid.subtotal)}` : ''}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── AI review card ────────────────────────────────────────────────────────────

function AIReviewCard({ notes, unreviewedCount, onDismiss }: {
  notes: string
  unreviewedCount: number
  onDismiss: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const PREVIEW_CHARS = 240

  const isLong = notes.length > PREVIEW_CHARS
  const displayText = isLong && !expanded ? notes.slice(0, PREVIEW_CHARS).trimEnd() + '…' : notes

  return (
    <div className="border border-primary/15 rounded-[14px] px-5 py-4 mb-4" style={{ background: '#FDFCFF' }}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-md bg-primary-light flex items-center justify-center shrink-0">
            <Sparkles size={11} className="text-primary" />
          </div>
          <div>
            <span className="text-[12px] font-semibold text-text-primary">AI Review</span>
            {unreviewedCount > 0 && (
              <span className="ml-2 text-[11px] font-medium text-warning">
                · {unreviewedCount} item{unreviewedCount !== 1 ? 's' : ''} flagged for review
              </span>
            )}
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="text-[11px] text-text-muted hover:text-text-secondary transition-colors shrink-0 mt-0.5"
        >
          Dismiss
        </button>
      </div>
      <p className="text-[11.5px] text-text-secondary leading-relaxed">{displayText}</p>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 text-[11px] font-medium text-primary hover:text-primary/70 transition-colors"
        >
          {expanded ? 'Show less' : 'Read full review'}
        </button>
      )}
    </div>
  )
}

// ── Inline edit row ───────────────────────────────────────────────────────────

function EditRow({ item, idx, bidId, onSaved, onCancel }: {
  item: BidLineItem
  idx: number
  bidId: string
  onSaved: (updated: BidLineItem) => void
  onCancel: () => void
}) {
  const [unitPrice, setUnitPrice] = useState(item.unit_price != null ? String(item.unit_price) : '')
  const [quantity, setQuantity] = useState(item.quantity != null ? String(item.quantity) : '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    const upNum = unitPrice !== '' ? parseFloat(unitPrice) : undefined
    const qNum = quantity !== '' ? parseFloat(quantity) : undefined
    try {
      await updateBidLineItem(bidId, idx, { unit_price: upNum, quantity: qNum })
      const updatedQty = qNum ?? item.quantity
      const updatedUP = upNum ?? item.unit_price
      const updatedTotal = updatedQty != null && updatedUP != null
        ? Math.round(updatedQty * updatedUP * 100) / 100
        : item.total
      onSaved({ ...item, unit_price: updatedUP ?? null, quantity: updatedQty ?? null, total: updatedTotal })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setSaving(false)
    }
  }

  return (
    <tr className="border-t border-border-light bg-primary-light/30">
      <td className="px-5 py-2.5">
        <span className="text-[11.5px] text-text-primary">{item.description}</span>
        {error && <p className="text-[10px] text-danger mt-0.5">{error}</p>}
      </td>
      <td className="px-3 py-2.5">
        <input
          type="number"
          value={quantity}
          onChange={e => setQuantity(e.target.value)}
          className="w-16 bg-surface border border-border text-text-primary text-[11px] rounded px-1.5 h-7 text-right tabular-nums focus:outline-none focus:border-primary transition-colors"
        />
      </td>
      <td className="px-3 py-2.5 text-[11.5px] text-text-muted">{item.unit}</td>
      <td className="px-3 py-2.5">
        <input
          type="number"
          value={unitPrice}
          onChange={e => setUnitPrice(e.target.value)}
          className="w-20 bg-surface border border-border text-text-primary text-[11px] rounded px-1.5 h-7 text-right tabular-nums focus:outline-none focus:border-primary transition-colors"
        />
      </td>
      <td className="px-3 py-2.5 text-right">
        <span className="text-[11.5px] font-mono tabular-nums text-text-muted">
          {quantity !== '' && unitPrice !== ''
            ? `$${(parseFloat(quantity) * parseFloat(unitPrice)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            : '—'}
        </span>
      </td>
      <td className="px-3 py-2.5"><SourceBadge source={item.source} /></td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-1 text-success hover:bg-success-bg rounded transition-colors disabled:opacity-50"
            title="Save"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
          </button>
          <button
            onClick={onCancel}
            className="p-1 text-text-muted hover:text-text-primary rounded hover:bg-surface-raised transition-colors"
            title="Cancel"
          >
            <X size={11} />
          </button>
        </div>
      </td>
    </tr>
  )
}
