// ── Types ─────────────────────────────────────────────────────────────────────

export interface BidLineItem {
  description: string
  quantity: number | null
  unit: string
  unit_price: number | null
  total: number | null
  source: 'history' | 'estimated'
  takeoff_ref: string
  notes: string | null
}

export interface Bid {
  bid_id: string
  project_id: string
  project_name: string
  vendor_id: string
  vendor_name: string
  cost_code: string
  cost_code_name: string
  status: 'generating' | 'needs_review' | 'approved' | 'sent' | 'failed'
  line_items: BidLineItem[]
  subtotal: number | null
  generated_at: string | null
  approved_at: string | null
  approved_by: string | null
  pdf_gcs_path: string | null
  generation_notes: string | null
  version: number | null
}

export interface BidSetupVendor {
  vendor_id: string
  vendor_name: string
  line_item_count: number
}

export interface BidSetupCostCode {
  cost_code: string
  cost_code_name: string
  takeoff_item_count: number
  vendors: BidSetupVendor[]
}

export interface BidSetup {
  project_id: string
  project_name: string
  cost_codes: BidSetupCostCode[]
}

export interface GenerateBidsResult {
  project_id: string
  bids_created: number
  cost_codes_covered: string[]
  vendors_invited: string[]
  notes_analyzed: boolean
}

export interface ProjectNotesStatus {
  found: boolean
  gcs_path: string | null
  filename: string | null
}

// ── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchBids(path: string, options?: RequestInit) {
  const res = await fetch(`/api/vendy/bids/${path}`, options)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Request failed')
  }
  return res.json()
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function getAllBids(): Promise<Bid[]> {
  return fetchBids('bids')
}

export async function getProjectBids(projectId: string): Promise<Bid[]> {
  return fetchBids(`bids/project/${projectId}`)
}

/** Returns cost codes + vendor choices for the vendor-selection setup screen. */
export async function getProjectBidSetup(projectId: string): Promise<BidSetup> {
  return fetchBids(`bids/project/${projectId}/setup`)
}

/**
 * Trigger bid generation.
 * `selection` is a per-cost-code vendor override: { "3100": ["vendor_id_1", ...] }
 * `notesGcsPath` is the GCS path to a project notes PDF — when provided the notes
 * are analyzed by Claude and factored into every vendor bid.
 */
export async function generateBids(
  projectId: string,
  selection?: Record<string, string[]>,
  notesGcsPath?: string | null,
): Promise<GenerateBidsResult> {
  return fetchBids(`bids/project/${projectId}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      selection: selection ?? null,
      notes_gcs_path: notesGcsPath ?? null,
    }),
  })
}

export async function getProjectNotesStatus(projectId: string): Promise<ProjectNotesStatus> {
  return fetchBids(`bids/project/${projectId}/notes-status`)
}

export async function uploadProjectNotes(
  projectId: string,
  file: File,
): Promise<{ gcs_path: string; filename: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`/api/vendy/bids/bids/project/${projectId}/notes`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail?: string }).detail ?? 'Upload failed')
  }
  return res.json()
}

export async function getBid(bidId: string): Promise<Bid> {
  return fetchBids(`bids/${bidId}`)
}

export async function updateLineItem(
  bidId: string,
  idx: number,
  data: { unit_price?: number; quantity?: number; notes?: string },
): Promise<void> {
  await fetchBids(`bids/${bidId}/line-items/${idx}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function approveBid(bidId: string): Promise<void> {
  await fetchBids(`bids/${bidId}/approve`, { method: 'POST' })
}

export async function sendBid(bidId: string): Promise<void> {
  await fetchBids(`bids/${bidId}/send`, { method: 'POST' })
}

export async function confirmBid(bidId: string): Promise<void> {
  await fetchBids(`bids/${bidId}/confirm`, { method: 'POST' })
}

export async function reviseBid(bidId: string): Promise<void> {
  await fetchBids(`bids/${bidId}/revise`, { method: 'POST' })
}

export async function awardBid(bidId: string): Promise<{ status: string; not_awarded_ids: string[] }> {
  return fetchBids(`bids/${bidId}/award`, { method: 'POST' })
}

export async function declineBid(bidId: string, outcome: 'not_awarded' | 'rejected'): Promise<void> {
  await fetchBids(`bids/${bidId}/decline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ outcome }),
  })
}

export async function addBidCommsNote(bidId: string, body: string): Promise<void> {
  await fetchBids(`bids/${bidId}/comms-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
}

/**
 * Downloads the bid PDF directly as a blob — no signed URL needed.
 * Returns a temporary object URL the caller should revoke after use.
 */
export async function downloadBidPdf(bidId: string, filename: string): Promise<void> {
  const res = await fetch(`/api/vendy/bids/bids/${bidId}/pdf`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? 'Failed to download PDF')
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function getCostCodesWithVendors(): Promise<BidSetupCostCode[]> {
  return fetchBids('cost-codes')
}
