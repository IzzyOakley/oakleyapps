'use client'

const API_BASE = '/api/vendy'

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function getProjects() {
  return apiFetch<import('./types').ProjectSummary[]>('/projects')
}

export async function getProject(projectId: string) {
  return apiFetch<import('./types').ProjectDetail>(`/projects/${projectId}`)
}

export async function createProject(jobName: string, address: string) {
  return apiFetch<{ project_id: string }>('/projects', {
    method: 'POST',
    body: JSON.stringify({ job_name: jobName, address }),
  })
}

export async function getBlueprintPages(projectId: string) {
  return apiFetch<{ pages: import('./types').BlueprintPage[] }>(`/projects/${projectId}/blueprint-pages`)
}

export async function startTakeoff(projectId: string) {
  return apiFetch<{ job_id: string; status: string }>(`/projects/${projectId}/takeoff`, { method: 'POST' })
}

export async function getJob(jobId: string) {
  return apiFetch<import('./types').TakeoffJob>(`/jobs/${jobId}`)
}

export async function updateItem(jobId: string, itemId: string, data: { pm_override?: number | null; notes?: string; status: 'confirmed' | 'overridden' }) {
  return apiFetch<{ status: string }>(`/jobs/${jobId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function updateJobSummary(jobId: string, data: Partial<import('./types').TakeoffSummary>) {
  return apiFetch<{ status: string }>(`/jobs/${jobId}/summary`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export async function approveJob(jobId: string) {
  return apiFetch<{ status: string; project_id: string }>(`/jobs/${jobId}/approve`, { method: 'POST' })
}

// ── Bids API (proxied to bid-generator via /api/vendy/bids/) ──────────────────

const BIDS_BASE = '/api/vendy/bids'

async function bidsFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BIDS_BASE}/${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? `Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function getAllBidsForHub() {
  return bidsFetch<import('./types').BidDocument[]>('bids')
}

export async function getBidsByProject(projectId: string) {
  return bidsFetch<import('./types').BidDocument[]>(`bids/project/${projectId}`)
}

export async function getBidDetail(bidId: string) {
  return bidsFetch<import('./types').BidDocument>(`bids/${bidId}`)
}

export async function updateBidLineItem(
  bidId: string,
  itemIndex: number,
  patch: { quantity?: number; unit_price?: number; notes?: string },
) {
  return bidsFetch<{ status: string }>(`bids/${bidId}/line-items/${itemIndex}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export async function approveBidDocument(bidId: string) {
  return bidsFetch<{ status: string; bid_id: string }>(`bids/${bidId}/approve`, { method: 'POST' })
}
