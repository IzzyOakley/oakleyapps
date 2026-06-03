'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Database,
  DoorOpen,
  Droplets,
  Grid3x3,
  Home,
  Layers,
  Loader2,
  Lock,
  Package,
  PaintBucket,
  Play,
  Shovel,
  Star,
  Wrench,
  Zap,
} from 'lucide-react'
import { approveTakeoffV2, getSharedParams, getV2Project, runAllAgents, runPreprocess, updateSharedParams } from '@/lib/vendy/takeoffs-v2-api'
import type { V2CostCodeDoc, V2ProjectDetail } from '@/lib/vendy/types'

interface Props {
  initialProject: V2ProjectDetail
  projectId: string
}

// ── Status badge helpers ──────────────────────────────────────────────────────

const AGENT_STATUS_STYLE: Record<string, string> = {
  pending:         'text-text-muted bg-surface-raised border border-border',
  running:         'text-primary bg-primary-light',
  complete:        'text-success bg-success-bg',
  failed:          'text-danger bg-danger-bg',
  manual_required: 'text-warning bg-warning-bg',
  skipped:         'text-text-muted bg-surface-raised border border-border',
}

const AGENT_STATUS_LABEL: Record<string, string> = {
  pending:         'Pending',
  running:         'Running…',
  complete:        'Complete',
  failed:          'Failed',
  manual_required: 'Manual',
  skipped:         'Skipped',
}

const CONFIDENCE_STYLE: Record<string, string> = {
  high:   'text-success',
  medium: 'text-warning',
  low:    'text-danger',
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ProjectDetailV2Client({ initialProject, projectId }: Props) {
  const router = useRouter()
  const [project, setProject] = useState<V2ProjectDetail>(initialProject)
  const [runAllLoading, setRunAllLoading] = useState(false)
  const [approveLoading, setApproveLoading] = useState(false)
  const [preprocessLoading, setPreprocessLoading] = useState(false)
  const [confirmDialog, setConfirmDialog] = useState<'run-all' | 'approve' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)

  const isRunning = project.status === 'in_progress'
  const isLocked = project.status === 'locked'

  // Poll every 3s while in_progress
  const refresh = useCallback(() => {
    getV2Project(projectId)
      .then(setProject)
      .catch(() => {})
  }, [projectId])

  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [isRunning, refresh])

  async function handleRunAll() {
    setConfirmDialog(null)
    setRunAllLoading(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      await runAllAgents(projectId)
      setActionSuccess('All agents queued — results will appear in real time.')
      refresh()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to start run-all')
    } finally {
      setRunAllLoading(false)
    }
  }

  async function handleApprove() {
    setConfirmDialog(null)
    setApproveLoading(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      await approveTakeoffV2(projectId)
      setActionSuccess('Takeoff approved and locked.')
      refresh()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to approve')
    } finally {
      setApproveLoading(false)
    }
  }

  async function handlePreprocess() {
    setPreprocessLoading(true)
    setActionError(null)
    setActionSuccess(null)
    try {
      await runPreprocess(projectId)
      setActionSuccess('Blueprint dimensions extraction started — status will update shortly.')
      refresh()
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed to start pre-process')
    } finally {
      setPreprocessLoading(false)
    }
  }

  // Group cost codes by category
  const grouped = groupByCategory(project.cost_codes ?? [])
  const stats = computeStats(project.cost_codes ?? [])

  // Check if any dxf-dependent cost codes are pending
  const dxfAgentTypes = new Set(['dxf_count', 'dxf_area', 'dxf_geometry'])
  const hasDxfPending = (project.cost_codes ?? []).some(
    cc => dxfAgentTypes.has(cc.agent_type) && cc.agent_status === 'pending',
  )

  return (
    <div className="animate-in fade-in">
      {/* Back + breadcrumb */}
      <button
        onClick={() => router.push('/vendy/takeoffs')}
        className="flex items-center gap-1.5 text-[12px] text-primary hover:text-primary/80 transition-colors mb-6"
      >
        <ChevronLeft size={14} /> Takeoffs
      </button>

      {/* Header card */}
      <div className="bg-surface border border-border rounded-2xl p-6 mb-5">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h1 className="text-[18px] font-semibold text-text-primary">
                {project.job_name}
              </h1>
              <ProjectStatusBadge status={project.status} />
              <SourceBadge source={project.project_source} />
              {project.dxf_present && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-primary bg-primary-light">
                  <Database size={9} /> DXF
                </span>
              )}
            </div>
            {project.address && (
              <p className="text-[12px] text-text-secondary">{project.address}</p>
            )}
          </div>

          {/* Actions */}
          {!isLocked && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => setConfirmDialog('run-all')}
                disabled={runAllLoading || isRunning || approveLoading}
                className="inline-flex items-center gap-1.5 h-9 px-4 text-[12px] font-medium bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {runAllLoading || isRunning ? (
                  <Loader2 size={13} className="animate-spin" />
                ) : (
                  <Play size={13} />
                )}
                {isRunning ? 'Running…' : 'Run All'}
              </button>
              {project.status === 'complete' && (
                <button
                  onClick={() => setConfirmDialog('approve')}
                  disabled={approveLoading}
                  className="inline-flex items-center gap-1.5 h-9 px-4 text-[12px] font-medium bg-success text-white rounded-lg hover:bg-success/90 transition-colors disabled:opacity-40"
                >
                  <CheckCircle size={13} />
                  Approve & Lock
                </button>
              )}
            </div>
          )}

          {isLocked && (
            <div className="flex items-center gap-1.5 text-success text-[12px] font-medium">
              <Lock size={14} />
              Locked by {project.locked_by ?? 'PM'}
            </div>
          )}
        </div>

        {/* Stats row */}
        {project.cost_codes && project.cost_codes.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border flex flex-wrap gap-5">
            <Stat label="Total codes" value={stats.total} />
            <Stat label="Complete" value={stats.complete} color="text-success" />
            {stats.manual > 0 && <Stat label="Manual" value={stats.manual} color="text-warning" />}
            {stats.failed > 0 && <Stat label="Failed" value={stats.failed} color="text-danger" />}
            <Stat label="Pending" value={stats.pending} />
            {stats.skipped > 0 && <Stat label="Skipped" value={stats.skipped} />}
          </div>
        )}
      </div>

      {/* Error / success banners */}
      {actionError && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-danger-bg border border-danger/20 rounded-xl text-danger text-[12px]">
          <AlertTriangle size={14} className="shrink-0" />
          {actionError}
        </div>
      )}
      {actionSuccess && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-success-bg border border-success/20 rounded-xl text-success text-[12px]">
          <CheckCircle size={14} className="shrink-0" />
          {actionSuccess}
        </div>
      )}

      {/* Validation report (if complete) */}
      {project.validation_report && (project.status === 'complete' || isLocked) && (
        <ValidationSummaryCard report={project.validation_report} />
      )}

      {/* Preprocess card */}
      {project.dxf_present && (
        <PreprocessCard
          projectId={projectId}
          status={project.preprocess_status}
          isLocked={isLocked}
          loading={preprocessLoading}
          onRun={handlePreprocess}
          showDxfHint={hasDxfPending && project.preprocess_status !== 'complete'}
        />
      )}

      {/* Cost code groups */}
      {grouped.length > 0 ? (
        <div className="space-y-3">
          {grouped.map(({ category, codes }) => (
            <CategorySection
              key={category}
              category={category}
              codes={codes}
              onClickCode={cc =>
                router.push(`/vendy/takeoffs/${projectId}/cost-codes/${cc.cost_code}`)
              }
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center h-40 text-text-muted text-[12px]">
          No cost codes loaded yet.
        </div>
      )}

      {/* Confirm dialogs */}
      {confirmDialog === 'run-all' && (
        <ConfirmDialog
          title="Run all agents?"
          message="This will queue all cost code agents in parallel. Current results will be overwritten. The project status will update in real time."
          confirmLabel="Run All"
          onConfirm={handleRunAll}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
      {confirmDialog === 'approve' && (
        <ConfirmDialog
          title="Approve and lock takeoff?"
          message="This will lock the project and publish an approval event. You won't be able to re-run agents or edit overrides after locking."
          confirmLabel="Approve & Lock"
          confirmClass="bg-success hover:bg-success/90"
          onConfirm={handleApprove}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  )
}

// ── Shared params label map ───────────────────────────────────────────────────

const SHARED_PARAMS_LABELS: Record<string, string> = {
  total_finished_sf: 'Total Finished SF',
  first_floor_sf: 'First Floor SF',
  first_floor_footprint_sf: 'First Floor Footprint SF',
  second_floor_sf: 'Second Floor SF',
  third_floor_sf: 'Third Floor SF',
  basement_sf_finished: 'Finished Basement SF',
  basement_sf_unfinished: 'Unfinished Basement SF',
  garage_sf: 'Garage SF',
  bathroom_count_full: 'Full Bathrooms',
  bathroom_count_half: 'Half Bathrooms',
  bedroom_count: 'Bedrooms',
  story_count: 'Stories',
}

// Fields that are not editable (metadata/non-numeric)
const NON_NUMERIC_FIELDS = new Set([
  'dxf_file',
  'dxf_gcs_path',
  'dxf_version',
  'layers_found',
  'layers_missing',
  'confidence',
  'flags',
  'has_detached_garage',
  'updated_at',
])

function toReadableLabel(field: string): string {
  if (SHARED_PARAMS_LABELS[field]) return SHARED_PARAMS_LABELS[field]
  return field
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

// ── Preprocess card ───────────────────────────────────────────────────────────

function PreprocessCard({
  projectId,
  status,
  isLocked,
  loading,
  onRun,
  showDxfHint,
}: {
  projectId: string
  status: string | null | undefined
  isLocked: boolean
  loading: boolean
  onRun: () => void
  showDxfHint: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [params, setParams] = useState<Record<string, number> | null>(null)
  const [paramsLoading, setParamsLoading] = useState(false)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saveLoading, setSaveLoading] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleToggle() {
    const next = !expanded
    setExpanded(next)
    if (next && status === 'complete' && params === null) {
      setParamsLoading(true)
      try {
        const data = await getSharedParams(projectId)
        // Filter to only numeric fields
        const numeric: Record<string, number> = {}
        for (const [k, v] of Object.entries(data)) {
          if (!NON_NUMERIC_FIELDS.has(k) && typeof v === 'number') {
            numeric[k] = v
          }
        }
        setParams(numeric)
      } catch {
        setParams({})
      } finally {
        setParamsLoading(false)
      }
    }
  }

  function handleEdit(field: string, value: string) {
    setEdits(prev => ({ ...prev, [field]: value }))
    setSaveSuccess(false)
    setSaveError(null)
  }

  const hasChanges = Object.keys(edits).some(k => {
    const edited = parseFloat(edits[k])
    return !isNaN(edited) && edited !== (params?.[k] ?? 0)
  })

  async function handleSave() {
    if (!params) return
    const updates: Record<string, number> = {}
    for (const [k, v] of Object.entries(edits)) {
      const parsed = parseFloat(v)
      if (!isNaN(parsed) && parsed !== params[k]) {
        updates[k] = parsed
      }
    }
    if (Object.keys(updates).length === 0) return
    setSaveLoading(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      const updated = await updateSharedParams(projectId, updates)
      const numeric: Record<string, number> = {}
      for (const [k, v] of Object.entries(updated)) {
        if (!NON_NUMERIC_FIELDS.has(k) && typeof v === 'number') {
          numeric[k] = v
        }
      }
      setParams(numeric)
      setEdits({})
      setSaveSuccess(true)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaveLoading(false)
    }
  }

  const statusEl = (() => {
    if (status === 'running') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-primary">
          <Loader2 size={12} className="animate-spin" /> Running…
        </span>
      )
    }
    if (status === 'complete') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-success">
          <CheckCircle size={12} /> Complete
        </span>
      )
    }
    if (status === 'failed') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] text-danger">
          <AlertTriangle size={12} /> Failed
        </span>
      )
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-text-muted bg-surface-raised border border-border">
        Not run
      </span>
    )
  })()

  return (
    <div className="bg-surface border border-border rounded-2xl mb-5 overflow-hidden">
      {/* Header row */}
      <div className="flex items-start justify-between flex-wrap gap-3 p-5">
        <button
          onClick={handleToggle}
          className="flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
        >
          <Database size={14} className="text-primary shrink-0" />
          <p className="text-[13px] font-semibold text-text-primary">Read Blueprint Dimensions</p>
          {statusEl}
          <ChevronDown
            size={13}
            className={`text-text-muted ml-auto transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </button>
        <button
          onClick={onRun}
          disabled={loading || status === 'running' || isLocked}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-[11px] font-medium bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
        >
          {loading || status === 'running' ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Play size={12} />
          )}
          Run
        </button>
      </div>

      {/* Description + hint */}
      {(!expanded) && (
        <div className="px-5 pb-4 -mt-2">
          <p className="text-[11px] text-text-secondary">
            Extracts square footage and room counts from your DXF files — required before agents can run
          </p>
          {showDxfHint && (
            <p className="mt-1.5 text-[11px] text-text-muted">
              Blueprint dimensions needed — run above before starting DXF agents
            </p>
          )}
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div className="border-t border-border px-5 pb-5 pt-4">
          {status !== 'complete' ? (
            <p className="text-[12px] text-text-muted">
              Run &ldquo;Read Blueprint Dimensions&rdquo; first to see extracted values.
            </p>
          ) : paramsLoading ? (
            <div className="flex items-center gap-2 text-[12px] text-text-muted py-2">
              <Loader2 size={13} className="animate-spin text-primary" /> Loading…
            </div>
          ) : params && Object.keys(params).length > 0 ? (
            <>
              <div className="divide-y divide-border/50">
                {Object.entries(params).map(([field, value]) => {
                  const editedVal = edits[field]
                  const isEdited = editedVal !== undefined && parseFloat(editedVal) !== value
                  return (
                    <div key={field} className="flex justify-between items-center py-2">
                      <span className="text-[12px] text-text-secondary flex items-center gap-1.5">
                        {toReadableLabel(field)}
                        {isEdited && (
                          <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
                        )}
                      </span>
                      <input
                        type="number"
                        disabled={isLocked}
                        value={editedVal !== undefined ? editedVal : String(value)}
                        onChange={e => handleEdit(field, e.target.value)}
                        className="w-28 text-right text-[13px] font-medium text-text-primary bg-transparent border border-border rounded-md px-2 py-1 focus:outline-none focus:border-primary disabled:opacity-50"
                      />
                    </div>
                  )
                })}
              </div>

              {/* Save row */}
              {!isLocked && (
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-border">
                  <div>
                    {saveSuccess && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-success">
                        <CheckCircle size={11} /> Saved
                      </span>
                    )}
                    {saveError && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-danger">
                        <AlertTriangle size={11} /> {saveError}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges || saveLoading}
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-[12px] font-medium bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saveLoading ? <Loader2 size={11} className="animate-spin" /> : null}
                    Save Changes
                  </button>
                </div>
              )}
            </>
          ) : (
            <p className="text-[12px] text-text-muted py-2">No extracted values found.</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Category section (collapsible) ────────────────────────────────────────────

function getCategoryIcon(category: string) {
  const c = category.toLowerCase()
  if (c.includes('site'))                           return <Shovel size={14} />
  if (c.includes('concrete') || c.includes('foundation')) return <Layers size={14} />
  if (c.includes('framing'))                        return <Grid3x3 size={14} />
  if (c.includes('exterior'))                       return <Home size={14} />
  if (c.includes('window') || c.includes('door'))  return <DoorOpen size={14} />
  if (c.includes('interior') || c.includes('paint') || c.includes('finish')) return <PaintBucket size={14} />
  if (c.includes('mechanical') || c.includes('hvac')) return <Wrench size={14} />
  if (c.includes('electrical'))                     return <Zap size={14} />
  if (c.includes('plumbing'))                       return <Droplets size={14} />
  if (c.includes('special') || c.includes('feature') || c.includes('option')) return <Star size={14} />
  return <Package size={14} />
}

function CategorySection({
  category,
  codes,
  onClickCode,
}: {
  category: string
  codes: V2CostCodeDoc[]
  onClickCode: (cc: V2CostCodeDoc) => void
}) {
  const [open, setOpen] = useState(true)
  const completeCount = codes.filter(c => c.agent_status === 'complete').length

  return (
    <div className="bg-surface border border-border rounded-2xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-surface-raised transition-colors text-left"
      >
        <span className="text-text-muted">{getCategoryIcon(category)}</span>
        <span className="flex-1 text-[12px] font-semibold text-text-primary">
          {category || 'Uncategorized'}
        </span>
        <span className="text-[11px] text-text-muted mr-2">
          {completeCount} complete / {codes.length} total
        </span>
        <ChevronDown
          size={14}
          className={`text-text-muted transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
        />
      </button>
      {open && (
        <div className="border-t border-border divide-y divide-border/50">
          {codes.map(cc => (
            <CostCodeCard
              key={cc.cost_code}
              doc={cc}
              onClick={() => onClickCode(cc)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Cost code card ────────────────────────────────────────────────────────────

function CostCodeCard({
  doc,
  onClick,
}: {
  doc: V2CostCodeDoc
  onClick: () => void
}) {
  const statusStyle = AGENT_STATUS_STYLE[doc.agent_status] ?? 'text-text-muted bg-surface-raised'
  const statusLabel = AGENT_STATUS_LABEL[doc.agent_status] ?? doc.agent_status

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-4 px-5 py-3.5 bg-surface hover:bg-surface-raised transition-all duration-150 text-left group"
    >
      {/* Status dot */}
      <div
        className={`w-2 h-2 rounded-full shrink-0 ${
          doc.agent_status === 'complete'
            ? 'bg-success'
            : doc.agent_status === 'failed'
              ? 'bg-danger'
              : doc.agent_status === 'manual_required'
                ? 'bg-warning'
                : doc.agent_status === 'running'
                  ? 'bg-primary animate-pulse'
                  : 'bg-border'
        }`}
      />

      {/* Code + name */}
      <div className="w-12 shrink-0">
        <p className="text-[11px] font-mono font-semibold text-text-muted">{doc.cost_code}</p>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-text-primary truncate">{doc.cost_code_name}</p>
        {doc.agent_status === 'complete' && doc.quantity !== null && (
          <p className="text-[11px] text-text-muted mt-0.5">
            {doc.quantity.toLocaleString()} {doc.unit ?? ''}
            {doc.confidence && (
              <span className={`ml-2 ${CONFIDENCE_STYLE[doc.confidence] ?? ''}`}>
                {doc.confidence} confidence
              </span>
            )}
          </p>
        )}
        {doc.agent_status === 'manual_required' && (
          <p className="text-[11px] text-warning mt-0.5">Needs manual entry</p>
        )}
      </div>

      {/* Estimate cost */}
      {doc.estimate_final_cost !== null && (
        <p className="text-[12px] text-text-secondary shrink-0 tabular-nums">
          ${doc.estimate_final_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </p>
      )}

      {/* Status badge */}
      <span
        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold shrink-0 ${statusStyle}`}
      >
        {statusLabel}
      </span>

      {/* Override indicator */}
      {doc.override_by && (
        <span className="text-[10px] text-text-muted shrink-0">edited</span>
      )}

      <ChevronRight
        size={14}
        className="text-text-muted group-hover:text-text-secondary transition-colors shrink-0"
      />
    </button>
  )
}

// ── Validation summary card ───────────────────────────────────────────────────

function ValidationSummaryCard({ report }: { report: Record<string, unknown> }) {
  const summary = report.summary_stats as Record<string, number> | undefined
  const claudeSummary = report.claude_summary as string | undefined
  const flagged = summary?.flagged ?? 0

  return (
    <div
      className={`mb-5 bg-surface border rounded-2xl p-5 ${
        flagged > 0 ? 'border-warning/30' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        {flagged > 0 ? (
          <AlertTriangle size={14} className="text-warning" />
        ) : (
          <CheckCircle size={14} className="text-success" />
        )}
        <span className="text-[13px] font-semibold text-text-primary">
          Validation Report
        </span>
        {flagged > 0 && (
          <span className="text-[11px] font-semibold text-warning bg-warning-bg px-2 py-0.5 rounded-full">
            {flagged} flagged
          </span>
        )}
      </div>
      {claudeSummary ? (
        <p className="text-[12px] text-text-secondary leading-relaxed line-clamp-4">
          {claudeSummary}
        </p>
      ) : (
        <p className="text-[12px] text-text-muted">No Claude summary available.</p>
      )}
    </div>
  )
}

// ── Confirm dialog ────────────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  message,
  confirmLabel,
  confirmClass = 'bg-primary hover:bg-primary-hover',
  onConfirm,
  onCancel,
}: {
  title: string
  message: string
  confirmLabel: string
  confirmClass?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onCancel} />
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-surface border border-border rounded-2xl p-6 max-w-sm w-full shadow-xl animate-in fade-in zoom-in-95 duration-150">
          <h3 className="text-[15px] font-semibold text-text-primary mb-2">{title}</h3>
          <p className="text-[12px] text-text-secondary leading-relaxed mb-5">{message}</p>
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 h-9 rounded-lg border border-border text-text-secondary text-[12px] hover:border-border-bright transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              className={`flex-1 h-9 rounded-lg text-white text-[12px] font-medium transition-colors ${confirmClass}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function ProjectStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:     { label: 'Pending',     cls: 'text-text-muted bg-surface-raised border border-border' },
    in_progress: { label: 'Running…',   cls: 'text-primary bg-primary-light' },
    complete:    { label: 'Complete',    cls: 'text-warning bg-warning-bg' },
    locked:      { label: 'Locked',      cls: 'text-success bg-success-bg' },
  }
  const { label, cls } = map[status] ?? { label: status, cls: '' }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${cls}`}>
      {label}
    </span>
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

function Stat({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color?: string
}) {
  return (
    <div>
      <p className={`text-[15px] font-semibold ${color ?? 'text-text-primary'}`}>
        {value}
      </p>
      <p className="text-[10px] text-text-muted">{label}</p>
    </div>
  )
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function groupByCategory(codes: V2CostCodeDoc[]): { category: string; codes: V2CostCodeDoc[] }[] {
  const map = new Map<string, V2CostCodeDoc[]>()
  for (const cc of codes) {
    const cat = cc.category ?? ''
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(cc)
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, codes]) => ({
      category,
      codes: codes.sort((a, b) => a.cost_code.localeCompare(b.cost_code)),
    }))
}

function computeStats(codes: V2CostCodeDoc[]) {
  return {
    total:    codes.length,
    complete: codes.filter(c => c.agent_status === 'complete').length,
    failed:   codes.filter(c => c.agent_status === 'failed').length,
    manual:   codes.filter(c => c.agent_status === 'manual_required').length,
    skipped:  codes.filter(c => c.agent_status === 'skipped').length,
    pending:  codes.filter(c => c.agent_status === 'pending' || c.agent_status === 'running').length,
  }
}
