'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle, ChevronLeft, ChevronRight, Loader2, Upload } from 'lucide-react'
import { getProject, getBlueprintPages, startTakeoff } from '@/lib/vendy/api'
import type { ProjectDetail, BlueprintPage } from '@/lib/vendy/types'

const FLAG_LABELS: Record<string, string> = {
  missing_structural_drawings: 'Structural drawings not uploaded',
  missing_door_schedule: 'Door schedule missing from plans',
  missing_window_schedule: 'Window schedule missing',
  missing_finish_schedule: 'Finish schedule missing',
  missing_grading_drawings: 'Grading drawings not found',
  landscaping_scope_unclear: 'Landscaping scope unclear',
}

const PROCESSING_MESSAGES = [
  'Reading blueprint...',
  'Extracting quantities...',
  'Organizing by section...',
  'Almost done...',
]

interface Props { projectId: string }

export default function ProjectDetailClient({ projectId }: Props) {
  const router = useRouter()
  const [project, setProject] = useState<ProjectDetail | null>(null)
  const [pages, setPages] = useState<BlueprintPage[]>([])
  const [currentPage, setCurrentPage] = useState(1)
  const [pagesLoading, setPagesLoading] = useState(false)
  const [pagesError, setPagesError] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [processingMsg, setProcessingMsg] = useState(0)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pagesLoadedRef = useRef<boolean>(false)

  const loadProject = useCallback(async () => {
    try {
      const p = await getProject(projectId)
      setProject(p)
      if (p.has_blueprint && !pagesLoadedRef.current) {
        pagesLoadedRef.current = true
        setPagesLoading(true)
        setPagesError(false)
        getBlueprintPages(projectId)
          .then(r => setPages(r.pages))
          .catch(() => setPagesError(true))
          .finally(() => setPagesLoading(false))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load project')
    }
  }, [projectId])

  useEffect(() => { loadProject() }, [loadProject])

  // Poll when processing
  useEffect(() => {
    if (project?.takeoff_status === 'processing') {
      pollRef.current = setInterval(loadProject, 5000)
      const msgTimer = setInterval(() => setProcessingMsg(m => (m + 1) % PROCESSING_MESSAGES.length), 15000)
      return () => {
        if (pollRef.current) clearInterval(pollRef.current)
        clearInterval(msgTimer)
      }
    } else {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [project?.takeoff_status, loadProject])

  async function handleFileUpload(file: File) {
    if (!file.name.toLowerCase().endsWith('.pdf')) return
    setUploadProgress(0)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const xhr = new XMLHttpRequest()
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100))
      }
      await new Promise<void>((resolve, reject) => {
        xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error('Upload failed')))
        xhr.onerror = () => reject(new Error('Upload failed'))
        xhr.open('POST', `/api/vendy/projects/${projectId}/blueprints`)
        xhr.send(formData)
      })
      setUploadProgress(null)
      await loadProject()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
      setUploadProgress(null)
    }
  }

  async function handleGenerateTakeoff() {
    setGenerating(true)
    setError(null)
    try {
      await startTakeoff(projectId)
      await loadProject()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start takeoff')
    } finally {
      setGenerating(false)
    }
  }

  if (!project && !error) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 size={24} className="animate-spin text-text-muted" />
      </div>
    )
  }

  if (error && !project) {
    return <div className="text-error text-sm mt-8">{error}</div>
  }

  const flags = project ? Object.entries(project.flags ?? {}).filter(([, v]) => v) : []
  const job = project?.latest_job
  const takeoffStatus = project?.takeoff_status ?? 'none'

  return (
    <div className="animate-in fade-in">
      <button onClick={() => router.push('/vendy/takeoffs')} className="flex items-center gap-1.5 text-sm text-text-muted hover:text-text-secondary transition-colors mb-6">
        <ChevronLeft size={16} />
        Takeoffs
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">

        {/* ── Left: main actions ── */}
        <div className="space-y-4">

          {/* Project info */}
          <div className="bg-surface border border-border rounded-2xl p-6">
            <h1 className="text-xl font-semibold text-text-primary">{project?.job_name}</h1>
            {project?.address && <p className="text-sm text-text-secondary mt-1">{project.address}</p>}
            {project?.bt_job_id && (
              <p className="text-xs text-text-muted font-mono mt-2">{project.bt_job_id}</p>
            )}
          </div>

          {/* Takeoff action card — prominent center piece */}
          <div className="bg-surface border border-border rounded-2xl p-6">
            <h2 className="text-sm font-semibold text-text-primary mb-4">Takeoff</h2>
            <TakeoffActionCard
              status={takeoffStatus}
              job={job ?? null}
              hasBlueprintPages={pages.length > 0 || !!project?.has_blueprint}
              generating={generating}
              onGenerate={handleGenerateTakeoff}
              processingMsg={PROCESSING_MESSAGES[processingMsg]}
              onReview={() => {
                if (job?.job_id) router.push(`/vendy/takeoffs/${projectId}/review/${job.job_id}`)
              }}
              onView={() => {
                if (job?.job_id) router.push(`/vendy/takeoffs/${projectId}/review/${job.job_id}`)
              }}
            />
            {error && <p className="text-xs text-error mt-4">{error}</p>}
          </div>

          {/* Flags */}
          {flags.length > 0 && (
            <div className="bg-surface border border-warning/20 rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle size={16} className="text-warning" />
                <h2 className="text-sm font-semibold text-text-primary">Plan Flags</h2>
              </div>
              <ul className="space-y-2">
                {flags.map(([key]) => (
                  <li key={key} className="flex items-start gap-2 text-sm text-text-secondary">
                    <span className="w-1.5 h-1.5 rounded-full bg-warning mt-1.5 shrink-0" />
                    {FLAG_LABELS[key] ?? key}
                  </li>
                ))}
              </ul>
              <p className="text-xs text-text-muted mt-3">These items will be flagged in the takeoff for your review.</p>
            </div>
          )}
        </div>

        {/* ── Right: blueprint panel ── */}
        <div className="bg-surface border border-border rounded-2xl overflow-hidden">
          {pagesLoading ? (
            <div className="flex items-center justify-center h-80">
              <Loader2 size={24} className="animate-spin text-text-muted" />
            </div>
          ) : pages.length > 0 ? (
            <BlueprintViewer pages={pages} currentPage={currentPage} onPageChange={setCurrentPage} />
          ) : pagesError ? (
            <div className="flex flex-col items-center justify-center h-80 gap-3 p-6">
              <div className="w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
                <AlertTriangle size={18} className="text-warning" />
              </div>
              <p className="text-sm font-medium text-text-primary text-center">Preview unavailable</p>
              <p className="text-xs text-text-muted text-center">
                Blueprint is stored — takeoff generation will still work.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="text-xs text-primary hover:underline"
              >
                Replace PDF
              </button>
              <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }} />
            </div>
          ) : (
            <UploadZone
              onFile={handleFileUpload}
              progress={uploadProgress}
              fileInputRef={fileInputRef}
            />
          )}
        </div>

      </div>
    </div>
  )
}

function BlueprintViewer({ pages, currentPage, onPageChange }: {
  pages: BlueprintPage[]
  currentPage: number
  onPageChange: (n: number) => void
}) {
  const page = pages[currentPage - 1]
  const [imgLoading, setImgLoading] = useState(true)

  return (
    <div className="flex flex-col" style={{ background: '#050508', minHeight: '520px' }}>
      <div className="flex-1 flex items-center justify-center p-4 relative">
        {imgLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-full h-full bg-surface-raised animate-pulse rounded-lg" />
          </div>
        )}
        {page && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={page.url}
            src={page.url}
            alt={`Blueprint page ${currentPage}`}
            className="max-w-full rounded-lg shadow-xl"
            onLoad={() => setImgLoading(false)}
            onError={() => setImgLoading(false)}
            style={{ display: imgLoading ? 'none' : 'block' }}
          />
        )}
      </div>
      <div className="sticky bottom-0 flex items-center justify-between px-5 py-3 bg-surface/90 backdrop-blur border-t border-border">
        <button
          disabled={currentPage <= 1}
          onClick={() => { setImgLoading(true); onPageChange(currentPage - 1) }}
          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={18} />
        </button>
        <span className="text-sm text-text-secondary">
          Page {currentPage} of {pages.length}
        </span>
        <button
          disabled={currentPage >= pages.length}
          onClick={() => { setImgLoading(true); onPageChange(currentPage + 1) }}
          className="p-1.5 rounded-lg text-text-muted hover:text-text-primary disabled:opacity-30 transition-colors"
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}

function UploadZone({ onFile, progress, fileInputRef }: {
  onFile: (f: File) => void
  progress: number | null
  fileInputRef: React.RefObject<HTMLInputElement>
}) {
  const [dragging, setDragging] = useState(false)

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f) }}
      onClick={() => fileInputRef.current?.click()}
      className={`flex flex-col items-center justify-center h-96 cursor-pointer border-2 border-dashed rounded-2xl transition-colors duration-150 m-4 ${dragging ? 'border-primary bg-primary/5' : 'border-border hover:border-border-bright'}`}
    >
      <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f) }} />
      <Upload size={32} className="text-text-muted mb-3" />
      <p className="text-sm font-medium text-text-primary">Drop blueprint PDF here or click to browse</p>
      <p className="text-xs text-text-muted mt-1">PDF files only</p>
      {progress !== null && (
        <div className="mt-4 w-48">
          <div className="h-1.5 bg-surface-raised rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-200" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-text-muted text-center mt-1">{progress}%</p>
        </div>
      )}
    </div>
  )
}

function TakeoffActionCard({ status, job, hasBlueprintPages, generating, onGenerate, processingMsg, onReview, onView }: {
  status: string
  job: import('@/lib/vendy/types').TakeoffJob | null
  hasBlueprintPages: boolean
  generating: boolean
  onGenerate: () => void
  processingMsg: string
  onReview: () => void
  onView: () => void
}) {
  if (status === 'approved') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-success font-medium">
          <CheckCircle size={18} />
          <span className="text-base">Takeoff approved</span>
        </div>
        <p className="text-sm text-text-muted">Approved by {job?.created_by}</p>
        <button onClick={onView} className="w-full h-11 rounded-xl border border-border text-text-secondary text-sm font-medium hover:border-border-bright transition-colors">
          View Takeoff
        </button>
      </div>
    )
  }

  if (status === 'needs_approval') {
    const summary = job?.takeoff_data?.summary
    return (
      <div className="space-y-3">
        <p className="text-base font-medium text-text-primary">Ready for review</p>
        {summary && (
          <p className="text-sm text-text-muted">
            {summary.total_items} items extracted · {summary.flagged_items} need your input
          </p>
        )}
        <button onClick={onReview} className="w-full h-11 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-hover active:scale-95 transition-all flex items-center justify-center gap-2">
          Review & Approve
          <ChevronRight size={16} />
        </button>
      </div>
    )
  }

  if (status === 'processing') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-primary font-medium animate-pulse">
          <Loader2 size={18} className="animate-spin" />
          <span className="text-base">Generating takeoff…</span>
        </div>
        <p className="text-sm text-text-muted">{processingMsg}</p>
        <p className="text-xs text-text-muted">Auto-refreshes every 5 seconds</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <button
        onClick={onGenerate}
        disabled={!hasBlueprintPages || generating}
        className="w-full h-11 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary-hover active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {generating ? <Loader2 size={16} className="animate-spin" /> : null}
        Generate Takeoff
      </button>
      <p className="text-sm text-text-muted">
        Claude reads the blueprint and extracts all quantities. Takes approximately 60–90 seconds.
      </p>
      {!hasBlueprintPages && (
        <p className="text-sm text-warning">Upload a blueprint PDF on the right to enable.</p>
      )}
    </div>
  )
}
