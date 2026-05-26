'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle, ChevronDown, ChevronLeft, ChevronRight, Lock, Loader2, X, FileOutput } from 'lucide-react'
import { getJob, getProject, updateItem, updateJobSummary, approveJob } from '@/lib/vendy/api'
import type { TakeoffJob, TakeoffSection, TakeoffItem, TakeoffSummary, ProjectDetail } from '@/lib/vendy/types'

interface Props { projectId: string; jobId: string }

export default function ReviewClient({ projectId, jobId }: Props) {
  const router = useRouter()
  const [job, setJob] = useState<TakeoffJob | null>(null)
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [allCollapsed, setAllCollapsed] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [showApproveModal, setShowApproveModal] = useState(false)
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const firstFlaggedRef = useRef<HTMLTableRowElement | null>(null)

  const loadData = useCallback(async () => {
    const [j, p] = await Promise.all([getJob(jobId), getProject(projectId)])
    setJob(j)
    setProject(p)
    setLoading(false)
  }, [jobId, projectId])

  useEffect(() => { loadData() }, [loadData])

  function toggleSection(id: string) {
    setCollapsedSections(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function handleCollapseAll() {
    const next = !allCollapsed
    setAllCollapsed(next)
    const state: Record<string, boolean> = {}
    job?.takeoff_data?.sections.forEach(s => { state[s.section_id] = next })
    setCollapsedSections(state)
  }

  function handleItemResolved(sectionId: string, itemId: string, qty: number | null, notes: string, status: 'confirmed' | 'overridden') {
    if (!job) return
    setJob(prev => {
      if (!prev?.takeoff_data) return prev
      const sections = prev.takeoff_data.sections.map(s => {
        if (s.section_id !== sectionId) return s
        return {
          ...s,
          items: s.items.map(i => {
            if (i.item_id !== itemId) return i
            return { ...i, flagged: false, status, quantity: qty ?? i.quantity, pm_override: qty, notes }
          }),
        }
      })
      const newFlagged = sections.flatMap(s => s.items).filter(i => i.flagged && i.status === 'flagged').length
      return {
        ...prev,
        takeoff_data: {
          ...prev.takeoff_data,
          sections,
          summary: { ...prev.takeoff_data.summary, flagged_items: newFlagged },
        },
      }
    })
  }

  async function handleApprove() {
    setApproving(true)
    setApproveError(null)
    try {
      await approveJob(jobId)
      setShowApproveModal(false)
      setApproved(true)
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : 'Approval failed')
    } finally {
      setApproving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (!job || !job.takeoff_data) {
    return <div className="text-error text-sm mt-8">Takeoff data not found.</div>
  }

  if (approved) {
    return (
      <div className="animate-in fade-in flex flex-col items-center justify-center min-h-[60vh] gap-6 text-center">
        <div className="w-16 h-16 rounded-full bg-success/15 flex items-center justify-center">
          <CheckCircle size={32} className="text-success" />
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-text-primary">Takeoff approved!</h2>
          <p className="text-sm text-text-secondary mt-2">
            This takeoff is now locked and ready for bid generation.
          </p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <button
            onClick={() => router.push(`/vendy/bids/${projectId}`)}
            className="inline-flex items-center gap-2 h-11 px-6 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover active:scale-95 transition-all"
          >
            <FileOutput size={16} />
            Generate Bids
          </button>
          <button
            onClick={() => router.push('/vendy/takeoffs')}
            className="text-sm text-text-muted hover:text-text-secondary transition-colors"
          >
            Back to Takeoffs
          </button>
        </div>
      </div>
    )
  }

  const { summary, sections } = job.takeoff_data
  const isApproved = project?.takeoff_status === 'approved'
  const remainingFlags = sections.flatMap(s => s.items).filter(i => i.flagged && i.status === 'flagged').length
  const canApprove = remainingFlags === 0 && !isApproved

  return (
    <div className="animate-in fade-in pb-16">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <button onClick={() => router.push(`/vendy/takeoffs/${projectId}`)} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors mb-3">
            <ChevronLeft size={16} />
            {project?.job_name ?? 'Project'}
          </button>
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
            Takeoff — {project?.job_name}
          </h1>
          <p className="text-sm text-text-secondary mt-1">
            {project?.address}
            {summary.sheets_processed ? ` · Extracted from ${summary.sheets_processed} sheets` : ''}
          </p>
        </div>
        {!isApproved && (
          <div className="shrink-0" title={!canApprove ? `Resolve ${remainingFlags} flagged items to approve.` : undefined}>
            <button
              onClick={() => setShowApproveModal(true)}
              disabled={!canApprove}
              className="inline-flex items-center gap-2 h-10 px-5 text-sm font-medium bg-primary text-white rounded-lg hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <CheckCircle size={15} />
              Approve Takeoff
            </button>
          </div>
        )}
      </div>

      {/* View-only banner */}
      {isApproved && (
        <div className="flex items-center gap-2 px-4 py-3 bg-success/10 border border-success/20 rounded-xl mb-6 text-sm text-success">
          <Lock size={15} />
          This takeoff is approved and locked. View only.
        </div>
      )}

      {/* Summary strip */}
      <SummaryStrip
        summary={summary}
        jobId={jobId}
        isApproved={isApproved}
        onUpdate={(updates) => {
          setJob(prev => prev?.takeoff_data
            ? { ...prev, takeoff_data: { ...prev.takeoff_data, summary: { ...prev.takeoff_data.summary, ...updates } } }
            : prev)
        }}
      />

      {/* Flagged banner */}
      {remainingFlags > 0 && !bannerDismissed && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 bg-warning/10 border border-warning/20 rounded-xl mb-6 text-sm">
          <div className="flex items-center gap-2 text-warning">
            <AlertTriangle size={15} />
            <span><strong>{remainingFlags}</strong> items need your input before this takeoff can be approved.</span>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => firstFlaggedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
              className="text-xs text-primary hover:underline"
            >
              Jump to first flagged
            </button>
            <button onClick={() => setBannerDismissed(true)} className="text-text-muted hover:text-text-secondary">
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Collapse toggle */}
      <div className="flex justify-end mb-4">
        <button onClick={handleCollapseAll} className="text-xs text-text-muted hover:text-text-secondary transition-colors">
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </button>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {sections.map(section => (
          <TakeoffSectionCard
            key={section.section_id}
            section={section}
            collapsed={collapsedSections[section.section_id] ?? false}
            onToggle={() => toggleSection(section.section_id)}
            isApproved={isApproved}
            onItemResolved={handleItemResolved}
            jobId={jobId}
            firstFlaggedRef={firstFlaggedRef}
          />
        ))}
      </div>

      {/* Approve modal */}
      {showApproveModal && (
        <ApproveModal
          onCancel={() => setShowApproveModal(false)}
          onConfirm={handleApprove}
          loading={approving}
          error={approveError}
        />
      )}
    </div>
  )
}

function SummaryStrip({ summary, jobId, isApproved, onUpdate }: {
  summary: TakeoffSummary
  jobId: string
  isApproved: boolean
  onUpdate: (updates: Partial<TakeoffSummary>) => void
}) {
  const stats: { label: string; field: keyof TakeoffSummary }[] = [
    { label: '1st Floor', field: 'first_floor_sf' },
    { label: '2nd Floor', field: 'second_floor_sf' },
    { label: 'Basement', field: 'basement_sf' },
    { label: 'Garage', field: 'garage_sf' },
    { label: 'Total FAR', field: 'total_far' },
    { label: 'Lot Size', field: 'lot_size_sf' },
  ]
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
      {stats.map(({ label, field }) => (
        <SummaryCard
          key={field}
          label={label}
          field={field}
          value={summary[field] as number | null}
          jobId={jobId}
          isApproved={isApproved}
          onSaved={(val) => onUpdate({ [field]: val })}
        />
      ))}
    </div>
  )
}

function SummaryCard({ label, field, value, jobId, isApproved, onSaved }: {
  label: string
  field: keyof TakeoffSummary
  value: number | null
  jobId: string
  isApproved: boolean
  onSaved: (val: number | null) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function startEdit() {
    if (isApproved) return
    setDraft(value != null ? String(value) : '')
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  async function commit() {
    const parsed = draft.trim() === '' ? null : parseFloat(draft.replace(/,/g, ''))
    if (isNaN(parsed as number) && parsed !== null) { setEditing(false); return }
    if (parsed === value) { setEditing(false); return }
    setSaving(true)
    try {
      await updateJobSummary(jobId, { [field]: parsed })
      onSaved(parsed)
    } finally {
      setSaving(false)
      setEditing(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') commit()
    if (e.key === 'Escape') setEditing(false)
  }

  return (
    <div
      onClick={!editing && !isApproved ? startEdit : undefined}
      className={`bg-surface border rounded-xl px-4 py-3 transition-colors ${
        !isApproved ? 'cursor-pointer hover:border-primary/50 hover:bg-surface-raised/40 group' : ''
      } ${editing ? 'border-primary ring-1 ring-primary/30' : 'border-border'}`}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
      {editing ? (
        <div className="flex items-baseline gap-1 mt-1">
          <input
            ref={inputRef}
            type="number"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={handleKeyDown}
            className="w-full bg-transparent text-xl font-semibold text-text-primary focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            autoFocus
          />
          <span className="text-sm font-normal text-text-muted shrink-0">SF</span>
        </div>
      ) : (
        <p className="text-xl font-semibold text-text-primary mt-1 flex items-baseline gap-1">
          {saving
            ? <Loader2 size={16} className="animate-spin text-text-muted" />
            : value != null ? value.toLocaleString() : <span className="text-text-muted text-base">—</span>
          }
          {value != null && !saving && <span className="text-sm font-normal text-text-muted">SF</span>}
          {!isApproved && !saving && <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity ml-1">edit</span>}
        </p>
      )}
    </div>
  )
}

function TakeoffSectionCard({ section, collapsed, onToggle, isApproved, onItemResolved, jobId, firstFlaggedRef }: {
  section: TakeoffSection
  collapsed: boolean
  onToggle: () => void
  isApproved: boolean
  onItemResolved: (sectionId: string, itemId: string, qty: number | null, notes: string, status: 'confirmed' | 'overridden') => void
  jobId: string
  firstFlaggedRef: React.MutableRefObject<HTMLTableRowElement | null>
}) {
  const flagged = section.items.filter(i => i.flagged && i.status === 'flagged').length
  const [expandedItem, setExpandedItem] = useState<string | null>(null)
  let firstFlaggedSet = false

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between bg-surface-raised px-6 py-4 text-left cursor-pointer hover:bg-surface-raised/70 transition-colors"
      >
        <div className="flex items-center gap-3">
          {collapsed ? <ChevronRight size={16} className="text-text-muted" /> : <ChevronDown size={16} className="text-text-muted" />}
          <span className="text-sm font-semibold text-text-primary">{section.title}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span>{section.items.length} items</span>
          {flagged > 0 && (
            <span className="flex items-center gap-1 text-warning">
              <AlertTriangle size={12} />
              {flagged} flagged
            </span>
          )}
        </div>
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-6 py-2 text-xs font-medium uppercase tracking-wider text-text-muted">Item</th>
                <th className="text-right px-3 py-2 text-xs font-medium uppercase tracking-wider text-text-muted w-24">Qty</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wider text-text-muted w-16">Unit</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wider text-text-muted w-28">Source</th>
                <th className="text-left px-3 py-2 text-xs font-medium uppercase tracking-wider text-text-muted w-36">Status</th>
              </tr>
            </thead>
            <tbody>
              {section.items.map(item => {
                const isFlagged = item.flagged && item.status === 'flagged'
                const isFirstFlagged = isFlagged && !firstFlaggedSet
                if (isFirstFlagged) firstFlaggedSet = true
                const isExpanded = expandedItem === item.item_id

                return (
                  <ItemRow
                    key={item.item_id}
                    item={item}
                    isFlagged={isFlagged}
                    isExpanded={isExpanded}
                    isApproved={isApproved}
                    isFirstFlagged={isFirstFlagged}
                    firstFlaggedRef={firstFlaggedRef}
                    onToggle={() => !isApproved && setExpandedItem(isExpanded ? null : item.item_id)}
                    onResolved={(qty, notes, status) => {
                      onItemResolved(section.section_id, item.item_id, qty, notes, status)
                      setExpandedItem(null)
                    }}
                    jobId={jobId}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ItemRow({ item, isFlagged, isExpanded, isApproved, isFirstFlagged, firstFlaggedRef, onToggle, onResolved, jobId }: {
  item: TakeoffItem
  isFlagged: boolean
  isExpanded: boolean
  isApproved: boolean
  isFirstFlagged: boolean
  firstFlaggedRef: React.MutableRefObject<HTMLTableRowElement | null>
  onToggle: () => void
  onResolved: (qty: number | null, notes: string, status: 'confirmed' | 'overridden') => void
  jobId: string
}) {
  return (
    <>
      <tr
        ref={isFirstFlagged ? firstFlaggedRef : null}
        onClick={onToggle}
        className={`border-t border-border transition-colors duration-100 ${
          isFlagged
            ? 'bg-warning/5 border-l-2 border-l-warning cursor-pointer hover:bg-warning/10'
            : isApproved ? '' : 'cursor-pointer hover:bg-surface-raised/50'
        } ${isApproved ? 'cursor-default' : ''}`}
      >
        <td className="px-6 py-3 text-text-primary">{item.description}</td>
        <td className={`px-3 py-3 text-right tabular-nums font-mono text-sm ${isFlagged ? 'text-warning' : 'text-text-primary'}`}>
          {item.pm_override != null ? item.pm_override.toLocaleString() : item.quantity != null ? item.quantity.toLocaleString() : '—'}
        </td>
        <td className="px-3 py-3 text-text-secondary">{item.unit}</td>
        <td className="px-3 py-3 text-text-muted text-xs font-mono">{item.source}</td>
        <td className="px-3 py-3">
          <StatusBadge status={item.status} flagged={item.flagged} />
        </td>
      </tr>
      {isExpanded && !isApproved && (
        <tr className="border-t border-warning/30">
          <td colSpan={5} className="p-0">
            <InlineEditPanel item={item} isFlagged={isFlagged} jobId={jobId} onResolved={onResolved} onCancel={onToggle} />
          </td>
        </tr>
      )}
    </>
  )
}

function StatusBadge({ status, flagged }: { status: string; flagged: boolean }) {
  if (flagged && status === 'flagged') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-warning/15 text-warning"><AlertTriangle size={11} /> Needs input</span>
  }
  if (status === 'overridden') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/15 text-primary">Overridden</span>
  }
  if (status === 'confirmed') {
    return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success/15 text-success"><CheckCircle size={11} /> Confirmed</span>
  }
  return <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-success/15 text-success"><CheckCircle size={11} /> Extracted</span>
}

function InlineEditPanel({ item, isFlagged, jobId, onResolved, onCancel }: {
  item: TakeoffItem
  isFlagged: boolean
  jobId: string
  onResolved: (qty: number | null, notes: string, status: 'confirmed' | 'overridden') => void
  onCancel: () => void
}) {
  const [qty, setQty] = useState('')
  const [notes, setNotes] = useState(item.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setSaving(true)
    setError(null)
    const qtyNum = qty !== '' ? parseFloat(qty) : null
    const status = qtyNum != null ? 'overridden' : 'confirmed'
    try {
      await updateItem(jobId, item.item_id, { pm_override: qtyNum, notes, status })
      onResolved(qtyNum, notes, status)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleNotApplicable() {
    setSaving(true)
    setError(null)
    try {
      await updateItem(jobId, item.item_id, { pm_override: null, notes: 'Not applicable', status: 'confirmed' })
      onResolved(null, 'Not applicable', 'confirmed')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-surface-raised border-t border-warning/30 px-6 py-4 animate-in fade-in duration-150">
      <p className="text-sm font-medium text-text-primary mb-1">{item.description}</p>
      <p className="text-xs text-text-muted mb-4">
        {isFlagged
          ? 'Claude estimated this quantity — verify and confirm, or enter a corrected value.'
          : 'Override the AI-extracted value if needed, or confirm it as-is.'}
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="text-xs text-text-muted uppercase tracking-wider block mb-1">Quantity</label>
          <input
            type="number"
            value={qty}
            onChange={e => setQty(e.target.value)}
            placeholder="—"
            className="w-28 bg-surface border border-border text-text-primary text-sm rounded-lg px-3 h-9 focus:outline-none focus:border-primary transition-colors"
          />
        </div>
        <div>
          <label className="text-xs text-text-muted uppercase tracking-wider block mb-1">Unit</label>
          <div className="h-9 px-3 flex items-center text-sm text-text-secondary bg-surface border border-border rounded-lg">
            {item.unit}
          </div>
        </div>
        <div className="flex-1 min-w-40">
          <label className="text-xs text-text-muted uppercase tracking-wider block mb-1">Notes</label>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Optional note..."
            className="w-full bg-surface border border-border text-text-primary text-sm rounded-lg px-3 h-9 focus:outline-none focus:border-primary transition-colors"
          />
        </div>
      </div>
      {error && <p className="text-xs text-error mt-2">{error}</p>}
      <div className="flex items-center justify-between mt-4">
        <div className="flex gap-2">
          <button onClick={onCancel} className="h-8 px-3 text-xs text-text-muted border border-border rounded-lg hover:border-border-bright transition-colors">
            Cancel
          </button>
          <button onClick={handleNotApplicable} disabled={saving} className="h-8 px-3 text-xs text-text-secondary border border-border rounded-lg hover:border-border-bright transition-colors disabled:opacity-50">
            Mark not applicable
          </button>
        </div>
        <button
          onClick={handleConfirm}
          disabled={saving}
          className="h-8 px-4 text-xs font-medium bg-primary text-white rounded-lg hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1.5"
        >
          {saving && <Loader2 size={12} className="animate-spin" />}
          Confirm
        </button>
      </div>
    </div>
  )
}

function ApproveModal({ onCancel, onConfirm, loading, error }: {
  onCancel: () => void
  onConfirm: () => void
  loading: boolean
  error: string | null
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center px-4">
      <div className="bg-surface border border-border rounded-2xl p-6 w-full max-w-sm shadow-xl shadow-black/40">
        <h2 className="text-lg font-semibold text-text-primary">Approve and lock this takeoff?</h2>
        <p className="text-sm text-text-secondary mt-2">
          This takeoff will be locked and made available to the Bid Generator and MargO. This action cannot be undone.
        </p>
        {error && <p className="text-sm text-error mt-3">{error}</p>}
        <div className="flex gap-3 mt-6">
          <button onClick={onCancel} className="flex-1 h-10 rounded-lg border border-border text-text-secondary text-sm hover:border-border-bright transition-colors">
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className="flex-1 h-10 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            Approve & Lock
          </button>
        </div>
      </div>
    </div>
  )
}
