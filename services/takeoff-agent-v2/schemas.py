from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


# ── Airtable / GCS source models ──────────────────────────────────────────────


class AirtableProject(BaseModel):
    record_id: str
    job_name: str
    address: str
    reference_home_ids: list[str] = []
    estimate_line_count: int = 0


class GCSProject(BaseModel):
    folder_name: str
    has_dxf: bool
    has_pdf: bool
    has_estimate_pdf: bool
    last_modified: Optional[str] = None


class EstimateLine(BaseModel):
    cost_code: str
    final_cost: float


# ── Shared DXF parameters ──────────────────────────────────────────────────────


class SharedParams(BaseModel):
    dxf_file: Optional[str] = None
    dxf_gcs_path: Optional[str] = None
    dxf_version: Optional[str] = None

    first_floor_sf: float = 0.0
    second_floor_sf: float = 0.0
    third_floor_sf: float = 0.0
    basement_sf_finished: float = 0.0
    basement_sf_unfinished: float = 0.0
    garage_sf: float = 0.0
    first_floor_footprint_sf: float = 0.0
    total_finished_sf: float = 0.0
    bathroom_count_full: int = 0
    bathroom_count_half: int = 0
    has_detached_garage: bool = False

    layers_found: list[str] = []
    layers_missing: list[str] = []
    confidence: str = "low"  # "high" | "medium" | "low"
    flags: list[str] = []


# ── Agent output ───────────────────────────────────────────────────────────────


class AgentOutput(BaseModel):
    quantity: Optional[float] = None
    unit: Optional[str] = None
    output: Optional[dict[str, Any]] = None
    source: str  # sf_formula | dxf_count | dxf_area | dxf_geometry | project_flag | historical_avg | manual | skip
    confidence: str = "low"  # "high" | "medium" | "low"
    notes: Optional[str] = None
    flags: list[str] = []


# ── v2 Firestore document shapes ───────────────────────────────────────────────


class V2CostCodeDoc(BaseModel):
    cost_code: str
    cost_code_name: str
    category: str
    is_profit_item: bool = False
    agent_type: str
    estimate_final_cost: Optional[float] = None
    agent_status: str = "pending"  # pending | running | complete | failed | manual_required | skipped
    agent_run_id: Optional[str] = None
    quantity: Optional[float] = None
    unit: Optional[str] = None
    output: Optional[dict[str, Any]] = None
    confidence: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None
    flags: list[str] = []
    overrides: Optional[dict[str, Any]] = None
    override_notes: Optional[str] = None
    override_by: Optional[str] = None


class V2Project(BaseModel):
    project_id: str
    job_name: str
    address: str
    project_source: str  # "airtable" | "gcs"
    airtable_record_id: Optional[str] = None
    reference_home_ids: list[str] = []
    estimate_pdf_gcs_path: Optional[str] = None
    status: str = "pending"  # pending | in_progress | complete | locked
    locked: bool = False
    locked_at: Optional[str] = None
    locked_by: Optional[str] = None
    dxf_present: bool = False
    dxf_gcs_path: Optional[str] = None
    preprocess_status: Optional[str] = None
    validation_status: Optional[str] = None
    validation_report: Optional[dict[str, Any]] = None
    created_by: Optional[str] = None
