'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle,
  ChevronRight,
  Database,
  FileText,
  Loader2,
  Upload,
} from 'lucide-react'
import {
  createFromAirtable,
  createFromGCS,
  EstimateParseError,
  listAirtableProjects,
  listGCSProjects,
  type EstimateLine,
} from '@/lib/vendy/takeoffs-v2-api'
import type { AirtableProjectOption, GCSProjectOption } from '@/lib/vendy/types'

type Tab = 'airtable' | 'gcs'

// ── Main component ────────────────────────────────────────────────────────────

export default function StartNewProjectClient() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('airtable')

  return (
    <div className="animate-in fade-in max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-7">
        <button
          onClick={() => router.push('/vendy/takeoffs')}
          className="flex items-center gap-1.5 text-[12px] text-primary hover:text-primary/80 transition-colors"
        >
          <ArrowLeft size={14} /> Takeoffs
        </button>
        <span className="text-text-muted text-[12px]">/</span>
        <span className="text-[12px] font-medium text-text-primary">New Project</span>
      </div>

      <div className="mb-6">
        <h1 className="text-[18px] font-semibold text-text-primary tracking-tight">
          Start a New Project
        </h1>
        <p className="text-[13px] text-text-secondary mt-1">
          Choose a source to import project details and estimate data.
        </p>
      </div>

      {/* Tab picker */}
      <div className="flex gap-1 p-1 bg-surface-raised border border-border rounded-xl mb-6 w-fit">
        {(['airtable', 'gcs'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-[12px] font-medium transition-colors ${
              tab === t
                ? 'bg-surface text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t === 'airtable' ? 'From Airtable' : 'From GCS / Historical'}
          </button>
        ))}
      </div>

      {tab === 'airtable' ? (
        <AirtableTab onCreated={id => router.push(`/vendy/takeoffs/${id}`)} />
      ) : (
        <GCSTab onCreated={id => router.push(`/vendy/takeoffs/${id}`)} />
      )}
    </div>
  )
}

// ── Airtable tab ──────────────────────────────────────────────────────────────

function AirtableTab({ onCreated }: { onCreated: (id: string) => void }) {
  const [projects, setProjects] = useState<AirtableProjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    listAirtableProjects()
      .then(setProjects)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  async function handleCreate() {
    if (!selected) return
    setCreating(true)
    setCreateError(null)
    try {
      const project = await createFromAirtable(selected)
      onCreated(project.project_id)
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : 'Failed to create project')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={22} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-warning-bg border border-warning/20 rounded-xl text-warning text-[12px]">
        <AlertTriangle size={14} className="shrink-0" />
        {error}
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="text-center py-16">
        <CheckCircle size={24} className="text-success mx-auto mb-3" />
        <p className="text-[13px] font-medium text-text-primary">All caught up</p>
        <p className="text-[12px] text-text-muted mt-1">
          No new Contract Signed projects in Airtable.
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
        Contract Signed — not yet in Vendy
      </p>
      <div className="space-y-2 mb-5">
        {projects.map(p => (
          <button
            key={p.record_id}
            onClick={() => setSelected(s => (s === p.record_id ? null : p.record_id))}
            className={`w-full flex items-center gap-4 px-5 py-4 bg-surface border rounded-[14px] transition-all duration-150 text-left group ${
              selected === p.record_id
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-border-bright hover:bg-surface-raised'
            }`}
          >
            <div
              className={`w-4 h-4 rounded-full border-2 shrink-0 transition-colors ${
                selected === p.record_id
                  ? 'border-primary bg-primary'
                  : 'border-border group-hover:border-text-secondary'
              }`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-text-primary">{p.job_name}</p>
              {p.address && (
                <p className="text-[11px] text-text-muted mt-0.5">{p.address}</p>
              )}
            </div>
            <span className="text-[11px] text-text-muted shrink-0">
              {p.estimate_line_count} cost codes
            </span>
          </button>
        ))}
      </div>

      {createError && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-danger-bg border border-danger/20 rounded-xl text-danger text-[12px]">
          <AlertTriangle size={14} className="shrink-0" />
          {createError}
        </div>
      )}

      <button
        onClick={handleCreate}
        disabled={!selected || creating}
        className="w-full h-10 rounded-xl bg-primary text-white text-[13px] font-medium hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {creating ? (
          <><Loader2 size={15} className="animate-spin" /> Creating…</>
        ) : (
          <>Import Project <ChevronRight size={15} /></>
        )}
      </button>
    </div>
  )
}

// ── GCS tab ───────────────────────────────────────────────────────────────────

type GCSStep = 'pick' | 'upload' | 'parse-error' | 'creating'

function GCSTab({ onCreated }: { onCreated: (id: string) => void }) {
  const [folders, setFolders] = useState<GCSProjectOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [step, setStep] = useState<GCSStep>('pick')

  // PDF upload state
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  // Parse error recovery state
  const [parseError, setParseError] = useState<string | null>(null)
  const [correctedLines, setCorrectedLines] = useState<EstimateLine[]>([])

  useEffect(() => {
    listGCSProjects()
      .then(setFolders)
      .catch(e => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  function handleSelectFolder(name: string) {
    setSelected(name)
    setStep('upload')
    setPdfFile(null)
    setUploadError(null)
  }

  function handleFile(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setUploadError('Only PDF files are accepted.')
      return
    }
    setPdfFile(file)
    setUploadError(null)
  }

  async function handleUploadAndCreate() {
    if (!selected || !pdfFile) return
    setUploading(true)
    setUploadError(null)
    try {
      const project = await createFromGCS(selected, pdfFile)
      onCreated(project.project_id)
    } catch (e) {
      if (e instanceof EstimateParseError) {
        setParseError(e.message)
        // Pre-populate corrected lines from raw extraction if available
        try {
          const lines = e.rawExtraction ? JSON.parse(e.rawExtraction) : []
          setCorrectedLines(
            Array.isArray(lines)
              ? lines.map((l: { cost_code?: string; final_cost?: number }) => ({
                  cost_code: String(l.cost_code ?? ''),
                  final_cost: Number(l.final_cost ?? 0),
                }))
              : [],
          )
        } catch {
          setCorrectedLines([])
        }
        setStep('parse-error')
      } else {
        setUploadError(e instanceof Error ? e.message : 'Failed to create project')
      }
    } finally {
      setUploading(false)
    }
  }

  async function handleRetryWithCorrections() {
    if (!selected || !pdfFile) return
    setUploading(true)
    setUploadError(null)
    try {
      const project = await createFromGCS(
        selected,
        pdfFile,
        correctedLines.filter(l => l.cost_code.trim() !== ''),
      )
      onCreated(project.project_id)
    } catch (e) {
      if (e instanceof EstimateParseError) {
        setParseError(e.message)
      } else {
        setUploadError(e instanceof Error ? e.message : 'Failed to create project')
      }
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 size={22} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 bg-warning-bg border border-warning/20 rounded-xl text-warning text-[12px]">
        <AlertTriangle size={14} className="shrink-0" />
        {error}
      </div>
    )
  }

  // ── Step: pick folder ─────────────────────────────────────────────────────
  if (step === 'pick') {
    return (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-widest text-text-secondary mb-3">
          GCS project folders
        </p>
        {folders.length === 0 ? (
          <p className="text-center py-16 text-[13px] text-text-muted">
            No GCS folders found that aren&apos;t already in Vendy.
          </p>
        ) : (
          <div className="space-y-2">
            {folders.map(f => (
              <button
                key={f.folder_name}
                onClick={() => handleSelectFolder(f.folder_name)}
                className="w-full flex items-center gap-4 px-5 py-4 bg-surface border border-border rounded-[14px] hover:border-border-bright hover:bg-surface-raised transition-all duration-150 text-left group"
              >
                <div className="w-8 h-8 rounded-lg bg-surface-raised flex items-center justify-center shrink-0">
                  <FileText size={14} className="text-text-muted" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-text-primary truncate">
                    {f.folder_name}
                  </p>
                  {f.last_modified && (
                    <p className="text-[11px] text-text-muted mt-0.5">
                      Modified {new Date(f.last_modified).toLocaleDateString()}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {f.has_dxf && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-primary bg-primary-light">
                      <Database size={9} /> DXF
                    </span>
                  )}
                  {f.has_estimate_pdf && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold text-success bg-success-bg">
                      Estimate PDF
                    </span>
                  )}
                </div>
                <ChevronRight size={14} className="text-text-muted shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  // ── Step: upload PDF ──────────────────────────────────────────────────────
  if (step === 'upload') {
    return (
      <div>
        <div className="flex items-center gap-3 mb-5">
          <button
            onClick={() => setStep('pick')}
            className="flex items-center gap-1.5 text-[12px] text-primary hover:text-primary/80 transition-colors"
          >
            <ArrowLeft size={14} /> Back
          </button>
          <span className="text-[12px] text-text-muted">/</span>
          <span className="text-[12px] font-medium text-text-primary truncate">
            {selected}
          </span>
        </div>

        <p className="text-[12px] text-text-secondary mb-4">
          Upload the estimate PDF for this project. Claude will extract cost codes
          and final costs.
        </p>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => {
            e.preventDefault()
            setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) handleFile(f)
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`flex flex-col items-center justify-center h-40 cursor-pointer border-2 border-dashed rounded-xl transition-colors duration-150 ${
            dragging
              ? 'border-primary bg-primary/5'
              : pdfFile
                ? 'border-success bg-success-bg/30'
                : 'border-border hover:border-border-bright'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />
          {pdfFile ? (
            <>
              <CheckCircle size={24} className="text-success mb-2" />
              <p className="text-[12px] font-medium text-text-primary">{pdfFile.name}</p>
              <p className="text-[11px] text-text-muted mt-0.5">
                {(pdfFile.size / 1024).toFixed(0)} KB — click to replace
              </p>
            </>
          ) : (
            <>
              <Upload size={24} className="text-text-muted mb-2" />
              <p className="text-[12px] font-medium text-text-primary">
                Drop estimate PDF here or click to browse
              </p>
              <p className="text-[11px] text-text-muted mt-0.5">PDF files only</p>
            </>
          )}
        </div>

        {uploadError && (
          <div className="mt-4 flex items-center gap-2 px-4 py-3 bg-danger-bg border border-danger/20 rounded-xl text-danger text-[12px]">
            <AlertTriangle size={14} className="shrink-0" />
            {uploadError}
          </div>
        )}

        <button
          onClick={handleUploadAndCreate}
          disabled={!pdfFile || uploading}
          className="mt-5 w-full h-10 rounded-xl bg-primary text-white text-[13px] font-medium hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {uploading ? (
            <><Loader2 size={15} className="animate-spin" /> Parsing estimate…</>
          ) : (
            <>Create Project <ChevronRight size={15} /></>
          )}
        </button>
      </div>
    )
  }

  // ── Step: parse error recovery ────────────────────────────────────────────
  if (step === 'parse-error') {
    return (
      <div>
        <div className="mb-5 flex items-start gap-3 px-4 py-3 bg-warning-bg border border-warning/20 rounded-xl">
          <AlertTriangle size={15} className="text-warning shrink-0 mt-0.5" />
          <div>
            <p className="text-[12px] font-medium text-text-primary">
              Estimate PDF could not be fully parsed
            </p>
            <p className="text-[11px] text-text-secondary mt-0.5">{parseError}</p>
          </div>
        </div>

        <p className="text-[12px] text-text-secondary mb-3">
          Review and correct the extracted lines below, then resubmit.
          Rows with empty cost codes will be ignored.
        </p>

        <div className="overflow-x-auto rounded-xl border border-border bg-surface mb-5">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-border bg-surface-raised">
                <th className="px-4 py-2 text-left font-semibold text-text-secondary w-32">
                  Cost Code
                </th>
                <th className="px-4 py-2 text-left font-semibold text-text-secondary">
                  Final Cost ($)
                </th>
                <th className="px-4 py-2 w-10" />
              </tr>
            </thead>
            <tbody>
              {correctedLines.map((line, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  <td className="px-4 py-2">
                    <input
                      value={line.cost_code}
                      onChange={e => {
                        const updated = [...correctedLines]
                        updated[i] = { ...updated[i], cost_code: e.target.value }
                        setCorrectedLines(updated)
                      }}
                      className="w-full bg-transparent border border-border rounded-md px-2 py-1 text-text-primary text-[12px] focus:outline-none focus:border-primary"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <input
                      type="number"
                      value={line.final_cost}
                      onChange={e => {
                        const updated = [...correctedLines]
                        updated[i] = { ...updated[i], final_cost: parseFloat(e.target.value) || 0 }
                        setCorrectedLines(updated)
                      }}
                      className="w-full bg-transparent border border-border rounded-md px-2 py-1 text-text-primary text-[12px] focus:outline-none focus:border-primary"
                    />
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => setCorrectedLines(correctedLines.filter((_, j) => j !== i))}
                      className="text-text-muted hover:text-danger transition-colors text-[11px]"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-4 py-2 border-t border-border">
            <button
              onClick={() =>
                setCorrectedLines([...correctedLines, { cost_code: '', final_cost: 0 }])
              }
              className="text-[11px] text-primary hover:text-primary/80 transition-colors"
            >
              + Add row
            </button>
          </div>
        </div>

        {uploadError && (
          <div className="mb-4 flex items-center gap-2 px-4 py-3 bg-danger-bg border border-danger/20 rounded-xl text-danger text-[12px]">
            <AlertTriangle size={14} className="shrink-0" />
            {uploadError}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => setStep('upload')}
            className="flex-1 h-10 rounded-xl border border-border text-text-secondary text-[12px] hover:border-border-bright transition-colors"
          >
            Replace PDF
          </button>
          <button
            onClick={handleRetryWithCorrections}
            disabled={uploading}
            className="flex-1 h-10 rounded-xl bg-primary text-white text-[13px] font-medium hover:bg-primary-hover transition-all disabled:opacity-40 flex items-center justify-center gap-2"
          >
            {uploading ? (
              <><Loader2 size={15} className="animate-spin" /> Creating…</>
            ) : (
              <>Create with Corrections <ChevronRight size={15} /></>
            )}
          </button>
        </div>
      </div>
    )
  }

  return null
}
