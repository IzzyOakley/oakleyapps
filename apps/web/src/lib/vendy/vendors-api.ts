// ── Types ─────────────────────────────────────────────────────────────────────

export interface VendorCostCode {
  full_code: string
  name: string
}

export interface CostCodeOption {
  full_code: string
  name: string
  category: string
  vendors: string[]
}

export interface VendorSummary {
  vendor_id: string
  name: string
  trade: string
  contact_email: string
  bid_format: 'itemized' | 'lump_sum'
  active: boolean
  bids_processed: number
  price_book_last_updated: string | null
  cost_codes: VendorCostCode[]
}

export interface PriceBookStats {
  min: number | null
  max: number | null
  avg: number | null
  sample_count: number
}

export interface PriceBookOutcome {
  unit_price: PriceBookStats
  extension: PriceBookStats
  last_seen: string | null
}

export interface PriceBookEntry {
  cost_code_name: string
  awarded: PriceBookOutcome
  not_awarded: PriceBookOutcome
}

export interface VendorDetail extends VendorSummary {
  price_book: {
    last_updated: string | null
    bids_processed: number
    categories: Record<string, Record<string, PriceBookEntry>>
  }
  created_at: string | null
  // cost_codes inherited from VendorSummary
}

export interface BidLedgerEntry {
  bid_id: string
  project_id: string
  project_name: string
  cost_code: string
  cost_code_name: string
  outcome: 'awarded' | 'not_awarded'
  bid_date: string
  subtotal: number | null
  line_items: unknown[]
  created_at: string | null
}

export interface BidLedgerPage {
  entries: BidLedgerEntry[]
  page: number
  has_more: boolean
}

// ── API helpers ───────────────────────────────────────────────────────────────

const BASE = '/api/vendy'

export async function listVendors(active?: boolean): Promise<VendorSummary[]> {
  const params = active !== undefined ? `?active=${active}` : ''
  const res = await fetch(`${BASE}/vendors${params}`)
  if (!res.ok) throw new Error(`listVendors: ${res.status}`)
  return res.json()
}

export async function getVendor(slug: string): Promise<VendorDetail> {
  const res = await fetch(`${BASE}/vendors/${slug}`)
  if (!res.ok) throw new Error(`getVendor: ${res.status}`)
  return res.json()
}

export async function createVendor(data: {
  name: string
  trade: string
  contact_email: string
  bid_format: string
}): Promise<{ vendor_id: string }> {
  const res = await fetch(`${BASE}/vendors`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `createVendor: ${res.status}`)
  }
  return res.json()
}

export async function updateVendor(
  slug: string,
  data: { active?: boolean; name?: string; trade?: string; contact_email?: string }
): Promise<{ vendor_id: string } & typeof data> {
  const res = await fetch(`${BASE}/vendors/${slug}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error(`updateVendor: ${res.status}`)
  return res.json()
}

/** @deprecated use updateVendor({ active }) instead */
export async function updateVendorActive(slug: string, active: boolean) {
  return updateVendor(slug, { active })
}

export async function getVendorBidLedger(
  slug: string,
  page = 1,
  outcome?: 'awarded' | 'not_awarded'
): Promise<BidLedgerPage> {
  const params = new URLSearchParams({ page: String(page) })
  if (outcome) params.set('outcome', outcome)
  const res = await fetch(`${BASE}/vendors/${slug}/bid-ledger?${params}`)
  if (!res.ok) throw new Error(`getVendorBidLedger: ${res.status}`)
  return res.json()
}

export async function listAllCostCodes(): Promise<CostCodeOption[]> {
  const res = await fetch(`${BASE}/cost-codes`)
  if (!res.ok) throw new Error(`listAllCostCodes: ${res.status}`)
  return res.json()
}

export async function updateVendorCostCodes(
  slug: string,
  costCodes: string[]
): Promise<void> {
  const res = await fetch(`${BASE}/vendors/${slug}/cost-codes`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cost_codes: costCodes }),
  })
  if (!res.ok) throw new Error(`updateVendorCostCodes: ${res.status}`)
}

export async function createCostCode(data: {
  full_code: string
  name: string
  category: string
}): Promise<{ full_code: string }> {
  const res = await fetch(`${BASE}/cost-codes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `createCostCode: ${res.status}`)
  }
  return res.json()
}
