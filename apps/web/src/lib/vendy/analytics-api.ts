// Analytics API client — proxied through /api/vendy/[...path] → takeoff-agent

async function fetchAnalytics(path: string) {
  const res = await fetch(`/api/vendy/analytics/${path}`, { cache: 'no-store' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error((err as { detail?: string }).detail ?? 'Request failed')
  }
  return res.json()
}

export interface AnalyticsSummary {
  total_awarded_ytd: number
  total_bids_processed: number
  most_active_cost_code: string
  top_vendor_win_rate: { vendor_id: string; win_rate_pct: number }
  source: 'bigquery' | 'firestore'
}

export interface VendorWinRate {
  vendor_id: string
  vendor_name: string
  awarded: number
  total: number
  win_rate_pct: number
}

export interface CoverageRow {
  cost_code: string
  cost_code_name: string
  awarded_count: number
  total_count: number
  vendor_count: number
  thin_coverage: boolean
}

export interface CostBudgetRow {
  project_id: string
  project_name: string
  budget: number | null
  awarded_total: number
  variance: number | null
  variance_pct: number | null
  over_budget: boolean
  status: string
}

export async function getAnalyticsSummary(): Promise<AnalyticsSummary> {
  return fetchAnalytics('summary')
}

export async function getVendorWinRates(costCode?: string): Promise<VendorWinRate[]> {
  const qs = costCode ? `?cost_code=${encodeURIComponent(costCode)}` : ''
  return fetchAnalytics(`vendor-win-rates${qs}`)
}

export async function getCoverage(): Promise<CoverageRow[]> {
  return fetchAnalytics('coverage')
}

export async function getCostVsBudget(): Promise<CostBudgetRow[]> {
  return fetchAnalytics('cost-vs-budget')
}
