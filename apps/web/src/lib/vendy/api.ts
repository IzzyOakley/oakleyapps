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

export async function approveJob(jobId: string) {
  return apiFetch<{ status: string; project_id: string }>(`/jobs/${jobId}/approve`, { method: 'POST' })
}
