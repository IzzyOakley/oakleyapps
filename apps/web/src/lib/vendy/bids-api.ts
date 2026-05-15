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
 * Omit to use all vendors from each cost code.
 */
export async function generateBids(
  projectId: string,
  selection?: Record<string, string[]>,
): Promise<GenerateBidsResult> {
  return fetchBids(`bids/project/${projectId}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ selection: selection ?? null }),
  })
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

export async function getBidPdfUrl(bidId: string): Promise<string> {
  const data = await fetchBids(`bids/${bidId}/pdf`)
  return data.url
}

export async function getCostCodesWithVendors(): Promise<BidSetupCostCode[]> {
  return fetchBids('cost-codes')
}
