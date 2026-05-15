from pydantic import BaseModel
from typing import Optional


class LineItemUpdate(BaseModel):
    unit_price: Optional[float] = None
    quantity: Optional[float] = None
    notes: Optional[str] = None


class GenerateBidsRequest(BaseModel):
    # Optional per-cost-code vendor override.
    # If omitted, all vendors from the cost code's vendors[] field are used.
    # {cost_code: [vendor_id, ...]}
    selection: Optional[dict[str, list[str]]] = None
