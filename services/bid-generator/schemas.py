from pydantic import BaseModel
from typing import Optional


class LineItemUpdate(BaseModel):
    unit_price: Optional[float] = None
    quantity: Optional[float] = None
    notes: Optional[str] = None


class DeclineBidRequest(BaseModel):
    outcome: str = "not_awarded"  # "not_awarded" | "rejected"


class BidCommsNoteRequest(BaseModel):
    body: str


class GenerateBidsRequest(BaseModel):
    # Optional per-cost-code vendor override.
    # If omitted, all vendors from the cost code's vendors[] field are used.
    # {cost_code: [vendor_id, ...]}
    selection: Optional[dict[str, list[str]]] = None
    # GCS path to a project notes PDF (e.g. projects/{job_name}/project-notes/notes.pdf).
    # When provided, the notes are analyzed with Claude before bid generation and the
    # extracted scope context is included in every vendor's bid prompt.
    notes_gcs_path: Optional[str] = None
