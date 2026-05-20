export interface TakeoffItem {
  item_id: string
  description: string
  quantity: number | null
  unit: string
  source: string
  notes: string | null
  flagged: boolean
  pm_override: number | null
  status: 'extracted' | 'flagged' | 'confirmed' | 'overridden'
}

export interface TakeoffSection {
  section_id: string
  title: string
  items: TakeoffItem[]
}

export interface TakeoffSummary {
  first_floor_sf: number | null
  second_floor_sf: number | null
  basement_sf: number | null
  garage_sf: number | null
  total_far: number | null
  lot_size_sf: number | null
  sheets_processed: number
  total_items: number
  flagged_items: number
}

export interface TakeoffData {
  summary: TakeoffSummary
  sections: TakeoffSection[]
}

export interface ProjectSummary {
  project_id: string
  job_name: string
  address: string
  status: string
  has_blueprint: boolean
  takeoff_status: 'none' | 'processing' | 'needs_approval' | 'approved'
  takeoff_job_id: string | null
  flags: Record<string, boolean>
}

export interface ProjectDetail extends ProjectSummary {
  bt_job_id?: string
  blueprint_gcs_path?: string
  latest_job?: TakeoffJob | null
}

export interface TakeoffJob {
  job_id: string
  project_ref: string
  status: 'pending' | 'processing' | 'complete' | 'failed'
  takeoff_data: TakeoffData | null
  created_by: string
  created_at: { _seconds: number } | string
  updated_at: { _seconds: number } | string
  flags: string[]
}

export interface BlueprintPage {
  page_number: number
  url: string
  width: number
  height: number
}

// ── Bid types ──────────────────────────────────────────────────────────────────

export type BidStatus =
  | 'generating'
  | 'needs_review'
  | 'approved'
  | 'sent'
  | 'confirmed'
  | 'revised'
  | 'awarded'
  | 'not_awarded'
  | 'failed'

export type BidLineItemSource = 'history' | 'generated' | 'estimated' | 'legacy'

export interface BidLineItem {
  description: string
  quantity: number | null
  unit: string
  unit_price: number | null
  total: number | null
  source: BidLineItemSource
  takeoff_ref: string
  notes: string | null
}

export interface BidDocument {
  bid_id: string
  project_id: string
  project_name: string
  vendor_id: string
  vendor_name: string
  cost_code: string
  cost_code_name: string
  status: BidStatus
  line_items: BidLineItem[]
  subtotal: number | null
  generated_at: string | null
  approved_at: string | null
  approved_by: string | null
  pdf_gcs_path: string | null
  generation_notes: string | null
  version: number | null
}

export interface BidSummary {
  bid_id: string
  project_id: string
  project_name: string
  vendor_id: string
  vendor_name: string
  cost_code: string
  cost_code_name: string
  status: BidStatus
  subtotal: number | null
  generated_at: string | null
  line_item_count: number
}
