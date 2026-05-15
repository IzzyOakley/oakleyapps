from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


class TakeoffItem(BaseModel):
    item_id: str
    description: str
    quantity: Optional[float] = None
    unit: str
    source: str
    notes: Optional[str] = None
    flagged: bool = False
    pm_override: Optional[float] = None
    status: str = "extracted"  # "extracted" | "flagged" | "confirmed" | "overridden"


class TakeoffSection(BaseModel):
    section_id: str
    title: str
    items: list[TakeoffItem]


class TakeoffSummary(BaseModel):
    first_floor_sf: Optional[float] = None
    second_floor_sf: Optional[float] = None
    basement_sf: Optional[float] = None
    garage_sf: Optional[float] = None
    total_far: Optional[float] = None
    lot_size_sf: Optional[float] = None
    sheets_processed: int = 0
    total_items: int = 0
    flagged_items: int = 0


class TakeoffData(BaseModel):
    summary: TakeoffSummary
    sections: list[TakeoffSection]


class CreateProjectRequest(BaseModel):
    job_name: str
    address: str


class UpdateItemRequest(BaseModel):
    pm_override: Optional[float] = None
    notes: Optional[str] = None
    status: str  # "confirmed" | "overridden"


class ProjectResponse(BaseModel):
    project_id: str
    job_name: str
    address: str
    status: str
    has_blueprint: bool
    takeoff_status: str  # "none" | "processing" | "needs_approval" | "approved"
    takeoff_job_id: Optional[str] = None
    flags: dict = {}
