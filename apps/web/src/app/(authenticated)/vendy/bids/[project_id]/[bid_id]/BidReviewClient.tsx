'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, Loader2, CheckCircle, Download, Edit2, AlertTriangle, X, Check } from 'lucide-react'
import { getBid, approveBid, downloadBidPdf, updateLineItem } from '@/lib/vendy/bids-api'
import type { Bid, BidLineItem } from '@/lib/vendy/bids-api'

interface Props { projectId: string; bidId: string }

export default function BidReviewClient({ projectId, bidId }: Props) {
  const router = useRouter()
  const [bid, setBid] = useState<Bid | null>(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)

  const loadBid = useCallback(async () => {
    try {
      const data = await getBid(bidId)
      setBid(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load bid')
    } finally {
      setLoading(false)
    }
  }, [bidId])

  useEffect(() => { loadBid() }, [loadBid])

  async function handleApprove() {
    setApproving(true)
    setError(null)
    try {
      await approveBid(bidId)
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
      setError(e instanceof Error ? e.message : 'Failed to download PDF')
    } finally {
      setDownloading(false)
    }
  }

  function handleLineItemSaved(idx: number, updatedItem: BidLineItem) {
    if (!bid) return
    const items = bid.line_items.map((item, i) => i === idx ? updatedItem : item)
    const subtotal = items.reduce((sum, item) => sum + (item.total ?? 0), 0)
    setBid({ ...bid, line_items: items, subtotal })
    setEditingIdx(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (!bid) {
    return <div className="text-error text-sm mt-8">{error ?? 'Bid not found.'}</div>
  }

  const canApprove = bid.status === 'needs_review'

  return (
    <div className="animate-in fade-in pb-16">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <button
            onClick={() => router.push(`/vendy/bids/${projectId}`)}
            className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors mb-3"
          >
            <ChevronLeft size={16} />
            {bid.project_name}
          </button>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
            {bid.vendor_name}
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            {bid.cost_code} — {bid.cost_code_name} · {bid.project_name}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <BidStatusBadge status={bid.status} />
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="inline-flex items-center gap-2 h-10 px-4 text-sm font-medium border border-border text-text-secondary rounded-lg hover:border-border-bright transition-colors disabled:opacity-50"
          >
            {downloading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            Download PDF
          </button>
          <button
            onClick={handleApprove}
            disabled={!canApprove || approving}
            title={!canApprove ? 'Bid must be in needs_review status to approve' : undefined}
            className="inline-flex items-center gap-2 h-10 px-5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {approving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            Approve
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-error/10 border border-error/20 rounded-xl mb-6 text-sm text-error">
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {/* Generation notes */}
      {bid.generation_notes && (
        <div className="flex items-start gap-2 px-4 py-3 bg-warning/10 border border-warning/20 rounded-xl mb-6 text-sm text-warning">
          <AlertTriangle size={15} className="shrink-0 mt-0.5" />
          <span>{bid.generation_notes}</span>
        </div>
      )}

      {/* Line items table */}
      <div className="bg-surface border border-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-raised">
                <th className="text-left px-6 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">Description</th>
                <th className="text-right px-3 py-3 text-xs font-medium uppercase tracking-wider text-text-muted w-20">Qty</th>
                <th className="text-left px-3 py-3 text-xs font-medium uppercase tracking-wider text-text-muted w-16">Unit</th>
                <th className="text-right px-3 py-3 text-xs font-medium uppercase tracking-wider text-text-muted w-24">Unit $</th>
                <th className="text-right px-3 py-3 text-xs font-medium uppercase tracking-wider text-text-muted w-24">Total</th>
                <th className="text-left px-3 py-3 text-xs font-medium uppercase tracking-wider text-text-muted w-24">Source</th>
                <th className="text-left px-3 py-3 text-xs font-medium uppercase tracking-wider text-text-muted">Notes</th>
                <th className="px-3 py-3 w-12" />
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
                  <tr key={idx} className="border-t border-border hover:bg-surface-raised/50 transition-colors">
                    <td className="px-6 py-3 text-text-primary">{item.description}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-mono text-sm text-text-primary">
                      {item.quantity != null ? item.quantity.toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-3 text-text-secondary">{item.unit}</td>
                    <td className="px-3 py-3 text-right tabular-nums font-mono text-sm text-text-primary">
                      {item.unit_price != null ? `$${item.unit_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums font-mono text-sm text-text-primary">
                      {item.total != null ? `$${item.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                    </td>
                    <td className="px-3 py-3">
                      <SourceBadge source={item.source} />
                    </td>
                    <td className="px-3 py-3 text-xs text-text-muted max-w-xs truncate">{item.notes ?? ''}</td>
                    <td className="px-3 py-3">
                      {bid.status !== 'approved' && (
                        <button
                          onClick={() => setEditingIdx(idx)}
                          className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-surface-raised transition-colors"
                          title="Edit line item"
                        >
                          <Edit2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              ))}
              {/* Subtotal row */}
              <tr className="border-t border-border bg-surface-raised/50">
                <td colSpan={4} className="px-6 py-3 text-right text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Subtotal
                </td>
                <td className="px-3 py-3 text-right tabular-nums font-mono font-semibold text-text-primary">
                  {bid.subtotal != null ? `$${bid.subtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                </td>
                <td colSpan={3} />
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

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
      await updateLineItem(bidId, idx, { unit_price: upNum, quantity: qNum })
      const updatedQty = qNum ?? item.quantity
      const updatedUP = upNum ?? item.unit_price
      const updatedTotal = updatedQty != null && updatedUP != null ? Math.round(updatedQty * updatedUP * 100) / 100 : item.total
      onSaved({
        ...item,
        unit_price: updatedUP ?? null,
        quantity: updatedQty ?? null,
        total: updatedTotal,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
      setSaving(false)
    }
  }

  return (
    <tr className="border-t border-border bg-primary/5">
      <td className="px-6 py-3 text-text-primary text-sm">{item.description}</td>
      <td className="px-3 py-3">
        <input
          type="number"
          value={quantity}
          onChange={e => setQuantity(e.target.value)}
          className="w-20 bg-surface border border-border text-text-primary text-sm rounded-lg px-2 h-8 text-right tabular-nums focus:outline-none focus:border-primary transition-colors"
        />
      </td>
      <td className="px-3 py-3 text-text-secondary text-sm">{item.unit}</td>
      <td className="px-3 py-3">
        <input
          type="number"
          value={unitPrice}
          onChange={e => setUnitPrice(e.target.value)}
          className="w-24 bg-surface border border-border text-text-primary text-sm rounded-lg px-2 h-8 text-right tabular-nums focus:outline-none focus:border-primary transition-colors"
        />
      </td>
      <td className="px-3 py-3 text-right tabular-nums font-mono text-sm text-text-muted">
        {quantity !== '' && unitPrice !== ''
          ? `$${(parseFloat(quantity) * parseFloat(unitPrice)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : '—'}
      </td>
      <td className="px-3 py-3"><SourceBadge source={item.source} /></td>
      <td className="px-3 py-3 text-xs text-error">{error}</td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1">
          <button
            onClick={handleSave}
            disabled={saving}
            className="p-1.5 text-success hover:bg-success/10 rounded-lg transition-colors disabled:opacity-50"
            title="Save"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
          </button>
          <button
            onClick={onCancel}
            className="p-1.5 text-text-muted hover:text-text-primary rounded-lg hover:bg-surface-raised transition-colors"
            title="Cancel"
          >
            <X size={13} />
          </button>
        </div>
      </td>
    </tr>
  )
}

function BidStatusBadge({ status }: { status: Bid['status'] }) {
  if (status === 'generating') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/15 text-primary animate-pulse">
        <Loader2 size={11} className="animate-spin" />
        Generating...
      </span>
    )
  }
  if (status === 'needs_review') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning/15 text-warning">
        Needs Review
      </span>
    )
  }
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success/15 text-success">
        <CheckCircle size={11} />
        Approved
      </span>
    )
  }
  if (status === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-error/15 text-error">
        <AlertTriangle size={11} />
        Failed
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-500/15 text-slate-400">
      {status}
    </span>
  )
}

function SourceBadge({ source }: { source: 'history' | 'estimated' }) {
  if (source === 'history') {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
        History
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-warning/10 text-warning">
      Estimated
    </span>
  )
}
