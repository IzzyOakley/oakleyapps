'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronRight, Loader2, Download,
  Edit2, AlertTriangle, X, Check, Sparkles,
  Send, Trophy, ThumbsDown, RotateCcw, MessageSquare,
  Clock, Ban,
} from 'lucide-react'
import { getBidDetail, updateBidLineItem } from '@/lib/vendy/api'
import {
  downloadBidPdf, sendBid, confirmBid, reviseBid,
  awardBid, declineBid, addBidCommsNote, getProjectBids,
} from '@/lib/vendy/bids-api'
import type { BidDocument, BidLineItem, BidLineItemSource, BidCommsNote } from '@/lib/vendy/types'

interface Props { projectId: string; bidId: string }

const TERMINAL_STATUSES = new Set(['awarded', 'not_awarded', 'rejected'])
const EDITABLE_STATUSES = new Set(['needs_review', 'approved', 'sent', 'confirmed', 'revised'])

function initials(name: string) {
  return name.split(/[\s_]+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('')
}
function vendorLabel(name: string) {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}
function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtTs(s: string) {
  return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
function isEstimated(s: BidLineItemSource) {
  return s === 'generated' || s === 'estimated'
}

// ── Status badge ──────────────────────────────────────────────────────────────

const STATUS_META: Record<string, { label: string; cls: string }> = {
  generating:   { label: 'Generating…',  cls: 'text-primary' },
  needs_review: { label: 'In Review',    cls: 'text-warning' },
  approved:     { label: 'Sent',         cls: 'text-info' },   // legacy
  sent:         { label: 'Sent',         cls: 'text-info' },
  confirmed:    { label: 'Confirmed',    cls: 'text-info' },
  revised:      { label: 'Revised',      cls: 'text-warning' },
  awarded:      { label: 'Awarded',      cls: 'text-success' },
  not_awarded:  { label: 'Not Awarded',  cls: 'text-text-muted' },
  rejected:     { label: 'Rejected',     cls: 'text-danger' },
  failed:       { label: 'Failed',       cls: 'text-danger' },
}

function StatusBadge({ status }: { status: string }) {
  const s = STATUS_META[status] ?? { label: status, cls: 'text-text-muted' }
  return <span className={`text-[13px] font-semibold ${s.cls}`}>{s.label}</span>
}

// ── Source badge ──────────────────────────────────────────────────────────────

function SourceBadge({ source }: { source: BidLineItemSource }) {
  if (source === 'history') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary-light text-primary">
        History
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

// ── Award confirmation modal ──────────────────────────────────────────────────

function AwardModal({
  bid,
  onConfirm,
  onCancel,
  loading,
}: {
  bid: BidDocument
  onConfirm: () => void
  onCancel: () => void
  loading: boolean
}) {
  const [siblings, setSiblings] = useState<BidDocument[]>([])

  useEffect(() => {
    getProjectBids(bid.project_id)
      .then(bids => setSiblings(
        bids.filter(b =>
          b.cost_code === bid.cost_code &&
          b.bid_id !== bid.bid_id &&
          !TERMINAL_STATUSES.has(b.status) &&
          b.status !== 'generating' &&
          b.status !== 'failed'
        )
      ))
      .catch(() => {})
  }, [bid.project_id, bid.cost_code, bid.bid_id])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center shrink-0">
            <Trophy size={18} className="text-success" />
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-text-primary">Award this bid?</h2>
            <p className="text-[12px] text-text-muted">
              {vendorLabel(bid.vendor_name)} · {bid.cost_code_name}
            </p>
          </div>
        </div>

        {siblings.length > 0 ? (
          <div className="mb-5 p-3 bg-warning-bg border border-warning/20 rounded-xl">
            <p className="text-[12px] font-medium text-text-primary mb-2">
              The following {siblings.length} vendor{siblings.length !== 1 ? 's' : ''} will automatically be marked <span className="font-semibold">Not Awarded</span>:
            </p>
            <ul className="space-y-1">
              {siblings.map(s => (
                <li key={s.bid_id} className="flex items-center gap-2 text-[12px] text-text-secondary">
                  <X size={10} className="text-warning shrink-0" />
                  {vendorLabel(s.vendor_name)}
                  {s.subtotal != null && <span className="text-text-muted ml-auto">${fmt(s.subtotal)}</span>}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-[12px] text-text-muted mb-5">
            No other active bids exist for this cost code on this project.
          </p>
        )}

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2 rounded-xl border border-border text-[13px] font-medium text-text-secondary hover:bg-surface-raised transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 py-2 rounded-xl bg-success text-white text-[13px] font-medium hover:bg-success/90 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Trophy size={14} />}
            Award Bid
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Action bar ────────────────────────────────────────────────────────────────

interface ActionBarProps {
  bid: BidDocument
  canSend: boolean
  unreviewedCount: number
  onAction: (action: string) => void
  busy: boolean
  error: string | null
}

function ActionBar({ bid, canSend, unreviewedCount, onAction, busy, error }: ActionBarProps) {
  const status = bid.status === 'approved' ? 'sent' : bid.status // treat legacy 'approved' as 'sent'

  if (TERMINAL_STATUSES.has(status)) return null

  return (
    <div className="bg-surface border border-border rounded-[14px] px-5 py-4 mb-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-0.5">Next action</p>
          {status === 'needs_review' && (
            <p className="text-[12px] text-text-secondary">
              Review all estimated line items, then send the bid to the vendor.
            </p>
          )}
          {status === 'sent' && (
            <p className="text-[12px] text-text-secondary">
              Waiting for vendor acknowledgement. Mark when confirmed or take action.
            </p>
          )}
          {(status === 'confirmed' || status === 'revised') && (
            <p className="text-[12px] text-text-secondary">
              Vendor has responded. Award, request revision, or decline.
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {status === 'needs_review' && (
            <button
              onClick={() => onAction('send')}
              disabled={!canSend || busy}
              title={!canSend ? `Review ${unreviewedCount} estimated item${unreviewedCount !== 1 ? 's' : ''} first` : undefined}
              className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold bg-primary text-white rounded-md hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
              Send to Vendor
            </button>
          )}

          {status === 'sent' && (
            <>
              <button
                onClick={() => onAction('confirm')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold bg-primary text-white rounded-md hover:bg-primary-hover transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Mark Confirmed
              </button>
              <button
                onClick={() => onAction('award')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-success border border-success/30 rounded-md hover:bg-success/10 transition-colors disabled:opacity-40"
              >
                <Trophy size={12} /> Award
              </button>
              <button
                onClick={() => onAction('not_awarded')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-text-muted border border-border rounded-md hover:bg-surface-raised transition-colors disabled:opacity-40"
              >
                <ThumbsDown size={12} /> Not Awarded
              </button>
              <button
                onClick={() => onAction('rejected')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-danger border border-danger/20 rounded-md hover:bg-danger-bg transition-colors disabled:opacity-40"
              >
                <Ban size={12} /> Reject
              </button>
            </>
          )}

          {(status === 'confirmed' || status === 'revised') && (
            <>
              <button
                onClick={() => onAction('award')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-4 text-xs font-semibold bg-success text-white rounded-md hover:bg-success/90 transition-colors disabled:opacity-40"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Trophy size={12} />}
                Award Bid
              </button>
              {status === 'confirmed' && (
                <button
                  onClick={() => onAction('revise')}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-warning border border-warning/30 rounded-md hover:bg-warning/10 transition-colors disabled:opacity-40"
                >
                  <RotateCcw size={12} /> Mark Revised
                </button>
              )}
              {status === 'revised' && (
                <button
                  onClick={() => onAction('confirm')}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-primary border border-primary/30 rounded-md hover:bg-primary/10 transition-colors disabled:opacity-40"
                >
                  <Check size={12} /> Mark Confirmed
                </button>
              )}
              <button
                onClick={() => onAction('not_awarded')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-text-muted border border-border rounded-md hover:bg-surface-raised transition-colors disabled:opacity-40"
              >
                <ThumbsDown size={12} /> Not Awarded
              </button>
              <button
                onClick={() => onAction('rejected')}
                disabled={busy}
                className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-semibold text-danger border border-danger/20 rounded-md hover:bg-danger-bg transition-colors disabled:opacity-40"
              >
                <Ban size={12} /> Reject
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 mt-3 px-3 py-2 bg-danger-bg border border-danger/20 rounded-lg text-xs text-danger">
          <AlertTriangle size={11} /> {error}
        </div>
      )}
    </div>
  )
}

// ── Communications log ────────────────────────────────────────────────────────

function CommsLogPanel({ bidId, notes }: { bidId: string; notes: BidCommsNote[] }) {
  const [log, setLog] = useState<BidCommsNote[]>(notes)
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleAdd() {
    if (!body.trim()) return
    setSaving(true)
    setErr(null)
    try {
      await addBidCommsNote(bidId, body.trim())
      setLog(prev => [{
        author: 'You',
        timestamp: new Date().toISOString(),
        body: body.trim(),
      }, ...prev])
      setBody('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-surface border border-border rounded-[14px] overflow-hidden mt-4">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border-light">
        <MessageSquare size={14} className="text-text-muted" />
        <p className="text-[12px] font-semibold text-text-primary">
          Communications Log
          {log.length > 0 && <span className="text-text-muted font-normal ml-1">{log.length} {log.length === 1 ? 'note' : 'notes'}</span>}
        </p>
      </div>

      {/* Add note */}
      <div className="px-5 py-3 border-b border-border-light bg-surface-raised/40">
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Add a note — call summary, vendor feedback, direction given…"
          rows={2}
          className="w-full bg-surface border border-border text-text-primary text-[12px] rounded-lg px-3 py-2 resize-none focus:outline-none focus:border-primary transition-colors placeholder:text-text-muted"
        />
        {err && <p className="text-[11px] text-danger mt-1">{err}</p>}
        <div className="flex justify-end mt-2">
          <button
            onClick={handleAdd}
            disabled={saving || !body.trim()}
            className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-semibold bg-primary text-white rounded-md hover:bg-primary-hover transition-colors disabled:opacity-40"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            Add Note
          </button>
        </div>
      </div>

      {/* Log entries */}
      {log.length === 0 ? (
        <div className="px-5 py-6 text-center text-[12px] text-text-muted">
          No notes yet. Log calls, emails, or decisions here.
        </div>
      ) : (
        <div className="divide-y divide-border-light">
          {log.map((note, i) => (
            <div key={i} className="px-5 py-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[11px] font-semibold text-text-secondary">{note.author}</span>
                <span className="text-[10px] text-text-muted flex items-center gap-1">
                  <Clock size={9} /> {fmtTs(note.timestamp)}
                </span>
              </div>
              <p className="text-[12px] text-text-primary leading-relaxed whitespace-pre-wrap">{note.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function BidReviewClient({ projectId, bidId }: Props) {
  const router = useRouter()
  const [bid, setBid] = useState<BidDocument | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [reviewedIdxs, setReviewedIdxs] = useState<Set<number>>(new Set())
  const [flagsDismissed, setFlagsDismissed] = useState(false)
  const [showAwardModal, setShowAwardModal] = useState(false)

  const loadBid = useCallback(async () => {
    try {
      const data = await getBidDetail(bidId)
      setBid(data)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load bid')
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

  async function handleAction(action: string) {
    if (!bid) return
    if (action === 'award') { setShowAwardModal(true); return }

    setActionBusy(true)
    setActionError(null)
    try {
      if (action === 'send') {
        await sendBid(bidId)
        setBid(prev => prev ? { ...prev, status: 'sent' } : prev)
      } else if (action === 'confirm') {
        await confirmBid(bidId)
        setBid(prev => prev ? { ...prev, status: 'confirmed' } : prev)
      } else if (action === 'revise') {
        await reviseBid(bidId)
        setBid(prev => prev ? { ...prev, status: 'revised' } : prev)
      } else if (action === 'not_awarded') {
        await declineBid(bidId, 'not_awarded')
        setBid(prev => prev ? { ...prev, status: 'not_awarded' } : prev)
      } else if (action === 'rejected') {
        await declineBid(bidId, 'rejected')
        setBid(prev => prev ? { ...prev, status: 'rejected' } : prev)
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setActionBusy(false)
    }
  }

  async function handleAwardConfirm() {
    setActionBusy(true)
    setActionError(null)
    try {
      await awardBid(bidId)
      setBid(prev => prev ? { ...prev, status: 'awarded' } : prev)
      setShowAwardModal(false)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Award failed')
      setShowAwardModal(false)
    } finally {
      setActionBusy(false)
    }
  }

  async function handleDownload() {
    if (!bid) return
    setDownloading(true)
    try {
      const filename = `bid_${bid.project_name}_${bid.vendor_name}_v${bid.version ?? 1}.pdf`
        .replace(/\s+/g, '_').toLowerCase()
      await downloadBidPdf(bidId, filename)
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Download failed')
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
    return <div className="text-danger text-sm mt-8">{loadError ?? 'Bid not found.'}</div>
  }

  const isEditable = EDITABLE_STATUSES.has(bid.status)

  return (
    <div className="animate-in fade-in pb-16 max-w-5xl">
      {showAwardModal && (
        <AwardModal
          bid={bid}
          onConfirm={handleAwardConfirm}
          onCancel={() => setShowAwardModal(false)}
          loading={actionBusy}
        />
      )}

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
                  <> · Generated {new Date(bid.generated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>
                )}
              </p>
            </div>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="h-8 w-8 flex items-center justify-center border border-border text-text-muted rounded-md hover:border-border-bright hover:text-text-secondary transition-colors disabled:opacity-50"
            title="Download PDF"
          >
            {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          </button>
        </div>

        {/* 4-column meta strip */}
        <div className="grid grid-cols-4 gap-4 mt-5 pt-4 border-t border-border-light">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted mb-0.5">Total Bid</p>
            <p className="text-[13px] font-semibold text-primary tabular-nums">
              {bid.subtotal != null ? `$${fmt(bid.subtotal)}` : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted mb-0.5">Status</p>
            <StatusBadge status={bid.status} />
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted mb-0.5">Line Items</p>
            <p className="text-[13px] font-semibold text-text-primary">{bid.line_items.length}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-text-muted mb-0.5">History Matched</p>
            <p className="text-[13px] font-semibold text-success">
              {historyCount} / {bid.line_items.length}
            </p>
          </div>
        </div>
      </div>

      {/* Action bar — contextual per status */}
      <ActionBar
        bid={bid}
        canSend={allReviewed}
        unreviewedCount={unreviewedCount}
        onAction={handleAction}
        busy={actionBusy}
        error={actionError}
      />

      {/* AI review card */}
      {bid.generation_notes && !flagsDismissed && (
        <AIReviewCard
          notes={bid.generation_notes}
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
          {unreviewedCount > 0 && bid.status === 'needs_review' && (
            <span className="text-[11px] text-warning font-medium">
              {unreviewedCount} estimated item{unreviewedCount !== 1 ? 's' : ''} need review
            </span>
          )}
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
                      isEstimated(item.source) && !reviewedIdxs.has(idx) && bid.status === 'needs_review'
                        ? 'bg-warning-bg/40 hover:bg-warning-bg/70'
                        : 'hover:bg-surface-raised/50'
                    }`}
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11.5px] text-text-primary">{item.description}</span>
                        {isEstimated(item.source) && !reviewedIdxs.has(idx) && bid.status === 'needs_review' && (
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
                      <span className={`text-[11.5px] font-mono tabular-nums font-medium ${isEstimated(item.source) && bid.status === 'needs_review' ? 'text-warning' : 'text-text-primary'}`}>
                        {item.total != null ? `$${fmt(item.total)}` : '—'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <SourceBadge source={item.source} />
                    </td>
                    <td className="px-3 py-3">
                      {isEditable && (
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
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Communications log */}
      <CommsLogPanel bidId={bidId} notes={bid.comms_log ?? []} />
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
