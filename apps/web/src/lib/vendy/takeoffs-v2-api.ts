'use client'

import type {
  AirtableProjectOption,
  GCSProjectOption,
  V2CostCodeDoc,
  V2ProjectDetail,
  V2ProjectSummary,
  V2RunLog,
} from './types'

const V2_BASE = '/api/vendy/takeoffs-v2/v2'

// ── Custom error for parse failures ──────────────────────────────────────────

export class EstimateParseError extends Error {
  rawExtraction: string | null
  constructor(message: string, rawExtraction?: string | null) {
    super(message)
    this.name = 'EstimateParseError'
    this.rawExtraction = rawExtraction ?? null
  }
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function v2Fetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${V2_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(
      typeof err.detail === 'string'
        ? err.detail
        : JSON.stringify(err.detail) ?? `Request failed: ${res.status}`,
    )
  }
  return res.json() as Promise<T>
}

// ── Projects ──────────────────────────────────────────────────────────────────

export async function listV2Projects(): Promise<V2ProjectSummary[]> {
  return v2Fetch<V2ProjectSummary[]>('/projects')
}

export async function getV2Project(projectId: string): Promise<V2ProjectDetail> {
  return v2Fetch<V2ProjectDetail>(`/projects/${projectId}`)
}

// ── Cost codes ────────────────────────────────────────────────────────────────

export async function getV2CostCode(
  projectId: string,
  costCode: string,
): Promise<V2CostCodeDoc> {
  return v2Fetch<V2CostCodeDoc>(`/projects/${projectId}/cost-codes/${costCode}`)
}

export async function getCostCodeRuns(
  projectId: string,
  costCode: string,
): Promise<V2RunLog[]> {
  return v2Fetch<V2RunLog[]>(`/projects/${projectId}/cost-codes/${costCode}/runs`)
}

// ── Source pickers ────────────────────────────────────────────────────────────

export async function listAirtableProjects(): Promise<AirtableProjectOption[]> {
  return v2Fetch<AirtableProjectOption[]>('/airtable/projects')
}

export async function listGCSProjects(): Promise<GCSProjectOption[]> {
  return v2Fetch<GCSProjectOption[]>('/gcs/projects')
}

// ── Project creation ──────────────────────────────────────────────────────────

export async function createFromAirtable(
  airtableRecordId: string,
): Promise<V2ProjectSummary> {
  return v2Fetch<V2ProjectSummary>('/projects/from-airtable', {
    method: 'POST',
    body: JSON.stringify({ airtable_record_id: airtableRecordId }),
  })
}

export interface EstimateLine {
  cost_code: string
  final_cost: number
}

export async function createFromGCS(
  folderName: string,
  estimatePdf: File,
  correctedLines?: EstimateLine[],
): Promise<V2ProjectSummary> {
  const formData = new FormData()
  formData.append('folder_name', folderName)
  formData.append('estimate_pdf', estimatePdf)
  if (correctedLines && correctedLines.length > 0) {
    formData.append('corrected_lines', JSON.stringify(correctedLines))
  }

  // Do NOT set Content-Type — browser sets it with the correct multipart boundary.
  const res = await fetch(`${V2_BASE}/projects/from-gcs`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    if (res.status === 422) {
      const detail = err.detail as
        | { message?: string; raw_extraction?: string }
        | string
      const msg =
        typeof detail === 'string'
          ? detail
          : (detail?.message ?? 'Could not parse estimate PDF')
      const raw =
        typeof detail === 'string' ? null : (detail?.raw_extraction ?? null)
      throw new EstimateParseError(msg, raw)
    }
    throw new Error(
      typeof err.detail === 'string' ? err.detail : JSON.stringify(err.detail),
    )
  }
  return res.json() as Promise<V2ProjectSummary>
}

// ── Agent execution ───────────────────────────────────────────────────────────

export async function runAllAgents(
  projectId: string,
): Promise<{ project_id: string; status: string; message: string }> {
  return v2Fetch(`/projects/${projectId}/run-all`, { method: 'POST' })
}

export async function runAgent(
  projectId: string,
  costCode: string,
): Promise<{ agent_status: string; run_id: string; agent_output: unknown }> {
  return v2Fetch(`/projects/${projectId}/run/${costCode}`, { method: 'POST' })
}

// ── Overrides ─────────────────────────────────────────────────────────────────

export async function runPreprocess(
  projectId: string,
): Promise<{ status: string; preprocess_status: string }> {
  return v2Fetch(`/projects/${projectId}/preprocess`, { method: 'POST' })
}

export async function updateCostCodeOverride(
  projectId: string,
  costCode: string,
  data: {
    quantity?: number | null
    unit?: string | null
    estimate_final_cost?: number | null
    overrides?: Record<string, unknown>
    override_notes?: string
    agent_type?: string
  },
): Promise<{ status: string }> {
  return v2Fetch(`/projects/${projectId}/cost-codes/${costCode}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

// ── Shared params ─────────────────────────────────────────────────────────────

export async function getSharedParams(projectId: string): Promise<Record<string, number>> {
  return v2Fetch<Record<string, number>>(`/projects/${projectId}/shared-params`)
}

export async function updateSharedParams(
  projectId: string,
  updates: Record<string, number>,
): Promise<Record<string, number>> {
  return v2Fetch<Record<string, number>>(`/projects/${projectId}/shared-params`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  })
}

// ── Estimate SF ───────────────────────────────────────────────────────────────

export async function updateEstimateSF(
  projectId: string,
  estimateSf: number,
): Promise<{ estimate_sf: number }> {
  return v2Fetch<{ estimate_sf: number }>(`/projects/${projectId}/estimate-sf`, {
    method: 'PATCH',
    body: JSON.stringify({ estimate_sf: estimateSf }),
  })
}

// ── Approval ──────────────────────────────────────────────────────────────────

export async function approveTakeoffV2(projectId: string): Promise<{
  project_id: string
  status: string
  approved_by: string
  pubsub_message_id: string | null
  pubsub_error: string | null
}> {
  return v2Fetch(`/projects/${projectId}/approve`, { method: 'POST' })
}
