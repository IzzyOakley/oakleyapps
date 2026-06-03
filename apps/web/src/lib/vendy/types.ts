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
  | 'approved'     // legacy — treated as 'sent'
  | 'sent'
  | 'confirmed'
  | 'revised'
  | 'awarded'
  | 'not_awarded'
  | 'rejected'
  | 'failed'

export interface BidCommsNote {
  author: string
  timestamp: string
  body: string
}

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
  comms_log?: BidCommsNote[]
  updated_at?: string | null
}

// ── v2 Takeoff types ───────────────────────────────────────────────────────────

export type V2ProjectStatus = 'pending' | 'in_progress' | 'complete' | 'locked'
export type V2AgentStatus = 'pending' | 'running' | 'complete' | 'failed' | 'manual_required' | 'skipped'
export type V2ProjectSource = 'airtable' | 'gcs'

export interface V2ProjectSummary {
  project_id: string
  job_name: string
  address: string
  project_source: V2ProjectSource
  status: V2ProjectStatus
  locked: boolean
  locked_at: string | null
  locked_by: string | null
  dxf_present: boolean
  dxf_gcs_path: string | null
  preprocess_status: string | null
  validation_status: string | null
  airtable_record_id: string | null
  created_by: string | null
}

export interface V2CostCodeDoc {
  cost_code: string
  cost_code_name: string
  category: string
  is_profit_item: boolean
  agent_type: string
  estimate_final_cost: number | null
  agent_status: V2AgentStatus
  agent_run_id: string | null
  quantity: number | null
  unit: string | null
  output: Record<string, unknown> | null
  confidence: 'high' | 'medium' | 'low' | null
  source: string | null
  notes: string | null
  flags: string[]
  overrides: Record<string, unknown> | null
  override_notes: string | null
  override_by: string | null
}

export interface V2ProjectDetail extends V2ProjectSummary {
  reference_home_ids: string[]
  estimate_pdf_gcs_path: string | null
  validation_report: Record<string, unknown> | null
  cost_codes: V2CostCodeDoc[]
  estimate_sf?: number | null
  sf_variance_pct?: number | null
  sf_validation?: 'no_estimate' | 'ok' | 'warning' | 'error' | null
}

export interface AirtableProjectOption {
  record_id: string
  job_name: string
  address: string
  reference_home_ids: string[]
  estimate_line_count: number
}

export interface GCSProjectOption {
  folder_name: string
  has_dxf: boolean
  has_pdf: boolean
  has_estimate_pdf: boolean
  last_modified: string | null
}

export interface V2RunLog {
  run_id?: string
  project_id: string
  cost_code?: string
  run_type: string
  agent_type?: string
  started_at: string | { _seconds: number }
  completed_at?: string | { _seconds: number }
  duration_ms?: number
  status: string
  agent_status?: string
  source?: string
  confidence?: string
  flags?: string[]
  triggered_by?: string
  error?: string
  uses_claude?: boolean
  input_tokens?: number
  output_tokens?: number
  model?: string
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
