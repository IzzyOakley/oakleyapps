'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle,
  ChevronLeft,
  Clock,
  Loader2,
  Play,
  RefreshCw,
} from 'lucide-react'
import {
  getCostCodeRuns,
  getV2CostCode,
  runAgent,
  updateCostCodeOverride,
} from '@/lib/vendy/takeoffs-v2-api'
import type { V2CostCodeDoc, V2RunLog } from '@/lib/vendy/types'

interface Props {
  projectId: string
  costCode: string
}

// ── Status styles ─────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  pending:         'text-text-muted bg-surface-raised border border-border',
  running:         'text-primary bg-primary-light',
  complete:        'text-success bg-success-bg',
  failed:          'text-danger bg-danger-bg',
  manual_required: 'text-warning bg-warning-bg',
  skipped:         'text-text-muted bg-surface-raised border border-border',
}

const STATUS_LABEL: Record<string, string> = {
  pending:         'Pending',
  running:         'Running…',
  complete:        'Complete',
  failed:          'Failed',
  manual_required: 'Manual Required',
  skipped:         'Skipped',
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CostCodeDetailClient({ projectId, costCode }: Props) {
  const router = useRouter()
  const [doc, setDoc] = useState<V2CostCodeDoc | null>(null)
  const [runs, setRuns] = useState<V2RunLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [runLoading, setRunLoading] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [runSuccess, setRunSuccess] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [ccDoc, ccRuns] = await Promise.all([
        getV2CostCode(projectId, costCode),
        getCostCodeRuns(projectId, costCode),
      ])
      setDoc(ccDoc)
      setRuns(ccRuns)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [projectId, costCode])

  useEffect(() => { load() }, [load])

  // Poll while running
  useEffect(() => {
    if (doc?.agent_status !== 'running') return
    const id = setInterval(load, 3000)
    return () => clearInterval(id)
  }, [doc?.agent_status, load])

  async function handleRunAgent() {
    setRunLoading(true)
    setRunError(null)
    setRunSuccess(null)
    try {
      const result = await runAgent(projectId, costCode)
      setRunSuccess(`Agent finished with status: ${result.agent_status}`)
      await load()
    } catch (e) {
      setRunError(e instanceof Error ? e.message : 'Agent run failed')
    } finally {
      setRunLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <AlertTriangle size={24} className="text-warning" />
        <p className="text-[13px] text-text-primary">{error ?? 'Cost code not found'}</p>
        <button
          onClick={() => router.push(`/vendy/takeoffs/${projectId}`)}
          className="text-[12px] text-primary hover:text-primary/80"
        >
          ← Back to project
        </button>
      </div>
    )
  }

  const statusLabel = STATUS_LABEL[doc.agent_status] ?? doc.agent_status
  const statusStyle = STATUS_STYLE[doc.agent_status] ?? 'text-text-muted bg-surface-raised'

  return (
    <div className="animate-in fade-in max-w-3xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 mb-6 text-[12px]">
        <button
          onClick={() => router.push('/vendy/takeoffs')}
          className="text-primary hover:text-primary/80 transition-colors"
        >
          Takeoffs
        </button>
        <span className="text-text-muted">/</span>
        <button
          onClick={() => router.push(`/vendy/takeoffs/${projectId}`)}
          className="text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
        >
          <ChevronLeft size={12} /> Project
        </button>
        <span className="text-text-muted">/</span>
        <span className="text-text-secondary font-medium">{costCode}</span>
      </div>

      {/* Header */}
      <div className="bg-surface border border-border rounded-2xl p-6 mb-5">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-[11px] font-mono font-semibold text-text-muted bg-surface-raised px-2 py-0.5 rounded">
                {costCode}
              </span>
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusStyle}`}
              >
                {statusLabel}
              </span>
              {doc.confidence && (
                <span
                  className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                    doc.confidence === 'high'
                      ? 'text-success bg-success-bg'
                      : doc.confidence === 'medium'
                        ? 'text-warning bg-warning-bg'
                        : 'text-danger bg-danger-bg'
                  }`}
                >
                  {doc.confidence} confidence
                </span>
              )}
            </div>
            <h1 className="text-[17px] font-semibold text-text-primary">{doc.cost_code_name}</h1>
            {doc.category && (
              <p className="text-[11px] text-text-muted mt-0.5">{doc.category}</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={load}
              className="h-9 px-3 inline-flex items-center gap-1.5 text-[12px] text-text-secondary border border-border rounded-lg hover:border-border-bright transition-colors"
            >
              <RefreshCw size={12} /> Refresh
            </button>
            <button
              onClick={handleRunAgent}
              disabled={runLoading || doc.agent_status === 'running'}
              className="h-9 px-4 inline-flex items-center gap-1.5 text-[12px] font-medium bg-primary text-white rounded-lg hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {runLoading || doc.agent_status === 'running' ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Play size={13} />
              )}
              Run Agent
            </button>
          </div>
        </div>

        {runError && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-danger-bg border border-danger/20 rounded-lg text-danger text-[11px]">
            <AlertTriangle size={12} className="shrink-0" />
            {runError}
          </div>
        )}
        {runSuccess && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-success-bg border border-success/20 rounded-lg text-success text-[11px]">
            <CheckCircle size={12} className="shrink-0" />
            {runSuccess}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
        {/* Left: output + override */}
        <div className="space-y-5">
          {/* Agent output */}
          <div className="bg-surface border border-border rounded-2xl p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-4">
              Agent Output
            </p>
            <AgentOutputPanel doc={doc} />
          </div>

          {/* PM Override panel */}
          <OverridePanel
            doc={doc}
            projectId={projectId}
            costCode={costCode}
            onSaved={load}
          />
        </div>

        {/* Right: estimate + run history */}
        <div className="space-y-5">
          {/* Estimate baseline */}
          <div className="bg-surface border border-border rounded-2xl p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
              Estimate Baseline
            </p>
            <div className="space-y-2.5">
              <Field
                label="Estimate Final Cost"
                value={
                  doc.estimate_final_cost !== null
                    ? `$${doc.estimate_final_cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
                    : '—'
                }
              />
              <Field
                label="Agent Type"
                value={doc.agent_type}
                mono
              />
              {doc.source && <Field label="Source" value={doc.source} mono />}
            </div>
          </div>

          {/* Flags */}
          {doc.flags && doc.flags.length > 0 && (
            <div className="bg-surface border border-warning/20 rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={13} className="text-warning" />
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary">
                  Flags
                </p>
              </div>
              <ul className="space-y-1.5">
                {doc.flags.map(f => (
                  <li key={f} className="text-[11px] text-text-secondary flex items-start gap-2">
                    <span className="w-1 h-1 rounded-full bg-warning mt-1.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Run history */}
          <RunHistory runs={runs} />
        </div>
      </div>
    </div>
  )
}

// ── Agent output panel ────────────────────────────────────────────────────────

function AgentOutputPanel({ doc }: { doc: V2CostCodeDoc }) {
  if (!doc.output && doc.agent_status === 'pending') {
    return (
      <p className="text-[12px] text-text-muted">
        Agent has not run yet. Click &quot;Run Agent&quot; to generate output.
      </p>
    )
  }

  if (doc.agent_status === 'skipped') {
    return (
      <p className="text-[12px] text-text-muted">
        This cost code is a profit item and is skipped during takeoff.
      </p>
    )
  }

  if (doc.agent_status === 'manual_required') {
    return (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={13} className="text-warning" />
          <p className="text-[12px] font-medium text-text-primary">Manual entry required</p>
        </div>
        <p className="text-[12px] text-text-secondary">
          This cost code requires a PM to enter the quantity and unit manually using the
          override panel.
        </p>
      </div>
    )
  }

  const out = doc.output as Record<string, unknown> | null

  // Quantity + unit — always shown when available
  const hasResult = doc.quantity !== null || doc.unit !== null
  if (!hasResult && !out) {
    return <p className="text-[12px] text-text-muted">No output available.</p>
  }

  return (
    <div className="space-y-3">
      {/* Primary result */}
      {hasResult && (
        <div className="flex items-baseline gap-2">
          <span className="text-[24px] font-semibold text-text-primary tabular-nums">
            {doc.quantity !== null ? doc.quantity.toLocaleString() : '—'}
          </span>
          <span className="text-[14px] text-text-secondary">{doc.unit ?? ''}</span>
        </div>
      )}

      {/* Agent-type-specific details */}
      {out && <OutputDetails output={out} agentType={doc.agent_type} />}

      {/* Notes */}
      {doc.notes && (
        <p className="text-[11px] text-text-muted border-t border-border pt-3 mt-3">
          {doc.notes}
        </p>
      )}
    </div>
  )
}

function OutputDetails({
  output,
  agentType,
}: {
  output: Record<string, unknown>
  agentType: string
}) {
  // sf_formula: show formula + inputs
  if (agentType === 'sf_formula') {
    const formula = output.formula as string | undefined
    const inputs = output.inputs as Record<string, number> | undefined
    return (
      <div className="space-y-2">
        {Boolean(formula) && (
          <Field label="Formula" value={formula!} mono />
        )}
        {inputs &&
          Object.entries(inputs).map(([k, v]) => (
            <Field
              key={k}
              label={k.replace(/_/g, ' ')}
              value={typeof v === 'number' ? v.toLocaleString() : String(v)}
            />
          ))}
      </div>
    )
  }

  // dxf_count: show layer + count
  if (agentType === 'dxf_count') {
    return (
      <div className="space-y-2">
        {Boolean(output.layers_checked) && (
          <Field
            label="Layers checked"
            value={(output.layers_checked as string[]).join(', ')}
            mono
          />
        )}
        {output.blocks_found !== undefined && (
          <Field label="Blocks found" value={String(output.blocks_found)} />
        )}
      </div>
    )
  }

  // dxf_area: show area details
  if (agentType === 'dxf_area') {
    return (
      <div className="space-y-2">
        {Boolean(output.layers_found) && (
          <Field
            label="Layers found"
            value={(output.layers_found as string[]).join(', ')}
            mono
          />
        )}
        {output.area_sf !== undefined && (
          <Field
            label="Area (SF)"
            value={(output.area_sf as number).toLocaleString()}
          />
        )}
      </div>
    )
  }

  // dxf_geometry
  if (agentType === 'dxf_geometry') {
    return (
      <div className="space-y-2">
        {Boolean(output.geometry_type) && (
          <Field label="Geometry type" value={String(output.geometry_type)} />
        )}
        {output.measurement !== undefined && (
          <Field
            label="Measurement"
            value={
              typeof output.measurement === 'number'
                ? output.measurement.toLocaleString()
                : String(output.measurement)
            }
          />
        )}
      </div>
    )
  }

  // project_flag (Claude)
  if (agentType === 'project_flag') {
    const reasoning = output.reasoning ?? output.summary
    const model = output.model as string | undefined
    return (
      <div className="space-y-2">
        {Boolean(reasoning) && (
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-1">
              Claude Reasoning
            </p>
            <p className="text-[12px] text-text-secondary leading-relaxed whitespace-pre-wrap">
              {String(reasoning)}
            </p>
          </div>
        )}
        {model && <Field label="Model" value={model} mono />}
        {output.input_tokens !== undefined && (
          <Field
            label="Tokens"
            value={`${output.input_tokens} in / ${output.output_tokens ?? 0} out`}
          />
        )}
      </div>
    )
  }

  // historical_avg
  if (agentType === 'historical_avg') {
    return (
      <div className="space-y-2">
        {output.avg_extension !== undefined && (
          <Field
            label="Price book avg extension"
            value={`$${(output.avg_extension as number).toLocaleString()}`}
          />
        )}
        {output.vendor_count !== undefined && (
          <Field label="Vendors sampled" value={String(output.vendor_count)} />
        )}
      </div>
    )
  }

  // Fallback: JSON dump
  return (
    <pre className="text-[11px] text-text-secondary bg-surface-raised rounded-lg p-3 overflow-x-auto leading-relaxed">
      {JSON.stringify(output, null, 2)}
    </pre>
  )
}

// ── Override panel ────────────────────────────────────────────────────────────

function OverridePanel({
  doc,
  projectId,
  costCode,
  onSaved,
}: {
  doc: V2CostCodeDoc
  projectId: string
  costCode: string
  onSaved: () => void
}) {
  const [quantity, setQuantity] = useState(doc.quantity !== null ? String(doc.quantity) : '')
  const [unit, setUnit] = useState(doc.unit ?? '')
  const [estimateCost, setEstimateCost] = useState(
    doc.estimate_final_cost !== null ? String(doc.estimate_final_cost) : '',
  )
  const [notes, setNotes] = useState(doc.override_notes ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      await updateCostCodeOverride(projectId, costCode, {
        quantity: quantity !== '' ? parseFloat(quantity) : null,
        unit: unit !== '' ? unit : null,
        estimate_final_cost:
          estimateCost !== '' ? parseFloat(estimateCost) : null,
        override_notes: notes,
      })
      setSaved(true)
      onSaved()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const isDirty =
    String(doc.quantity ?? '') !== quantity ||
    (doc.unit ?? '') !== unit ||
    String(doc.estimate_final_cost ?? '') !== estimateCost ||
    (doc.override_notes ?? '') !== notes

  return (
    <div className="bg-surface border border-border rounded-2xl p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-4">
        PM Override
      </p>

      {doc.override_by && (
        <p className="text-[11px] text-text-muted mb-3">
          Last edited by {doc.override_by}
        </p>
      )}

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <OverrideField
            label="Quantity"
            value={quantity}
            onChange={setQuantity}
            type="number"
            placeholder={doc.quantity !== null ? String(doc.quantity) : 'e.g. 2400'}
          />
          <OverrideField
            label="Unit"
            value={unit}
            onChange={setUnit}
            placeholder={doc.unit ?? 'e.g. SF'}
          />
        </div>
        <OverrideField
          label="Estimate Final Cost ($)"
          value={estimateCost}
          onChange={setEstimateCost}
          type="number"
          placeholder={doc.estimate_final_cost !== null ? String(doc.estimate_final_cost) : 'e.g. 45000'}
        />
        <div>
          <label className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary block mb-1.5">
            Override Notes
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            placeholder="Reason for override…"
            className="w-full bg-surface-raised border border-border text-text-primary text-[12px] rounded-lg px-3 py-2 focus:outline-none focus:border-primary transition-colors resize-none"
          />
        </div>
      </div>

      {saveError && (
        <p className="mt-3 text-[11px] text-danger">{saveError}</p>
      )}
      {saved && !saveError && (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-success">
          <CheckCircle size={12} /> Saved
        </div>
      )}

      <button
        onClick={handleSave}
        disabled={saving || !isDirty}
        className="mt-4 w-full h-9 rounded-lg bg-primary text-white text-[12px] font-medium hover:bg-primary-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
      >
        {saving ? <Loader2 size={13} className="animate-spin" /> : null}
        {saving ? 'Saving…' : 'Save Override'}
      </button>
    </div>
  )
}

function OverrideField({
  label,
  value,
  onChange,
  type = 'text',
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-wider text-text-secondary block mb-1.5">
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-surface-raised border border-border text-text-primary text-[12px] rounded-lg px-3 h-9 focus:outline-none focus:border-primary transition-colors"
      />
    </div>
  )
}

// ── Run history ───────────────────────────────────────────────────────────────

function RunHistory({ runs }: { runs: V2RunLog[] }) {
  if (runs.length === 0) {
    return (
      <div className="bg-surface border border-border rounded-2xl p-5">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          Run History
        </p>
        <p className="text-[12px] text-text-muted">No runs yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded-2xl p-5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
        Run History
      </p>
      <div className="space-y-2">
        {runs.map((run, i) => (
          <RunRow key={i} run={run} />
        ))}
      </div>
    </div>
  )
}

function RunRow({ run }: { run: V2RunLog }) {
  const ts = run.started_at
  const dateStr =
    ts && typeof ts === 'object' && '_seconds' in ts
      ? new Date((ts as { _seconds: number })._seconds * 1000).toLocaleString()
      : typeof ts === 'string'
        ? new Date(ts).toLocaleString()
        : '—'

  const statusStyle =
    run.status === 'complete'
      ? 'text-success'
      : run.status === 'failed'
        ? 'text-danger'
        : 'text-text-muted'

  return (
    <div className="flex items-start gap-3 py-2 border-b border-border/50 last:border-0">
      <Clock size={12} className="text-text-muted mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-[11px] font-semibold ${statusStyle}`}>
            {run.agent_status ?? run.status}
          </span>
          {run.triggered_by && (
            <span className="text-[10px] text-text-muted truncate">
              by {run.triggered_by}
            </span>
          )}
        </div>
        <p className="text-[10px] text-text-muted mt-0.5">{dateStr}</p>
        {run.duration_ms !== undefined && (
          <p className="text-[10px] text-text-muted">{run.duration_ms}ms</p>
        )}
        {run.error && (
          <p className="text-[10px] text-danger mt-0.5 truncate">{run.error}</p>
        )}
      </div>
    </div>
  )
}

// ── Field helper ──────────────────────────────────────────────────────────────

function Field({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-text-muted shrink-0">{label}</span>
      <span
        className={`text-[12px] text-text-primary text-right truncate ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </span>
    </div>
  )
}
