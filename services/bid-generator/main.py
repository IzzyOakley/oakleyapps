import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).parent / ".env")

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import firestore_client as fs
import pdf_client as pdf
from generator import generate_bid
from schemas import LineItemUpdate, GenerateBidsRequest

INTERNAL_SERVICE_SECRET = os.environ.get("INTERNAL_SERVICE_SECRET", "oakley-internal-dev")

# ── Section ID → Cost Code mapping ───────────────────────────────────────────
# Takeoff sections use section_id (e.g. "foundation_concrete") rather than a
# numeric cost_code. This map bridges them so bids can be generated per section.
# Multiple cost codes per section: we use the first one that has vendor coverage.
SECTION_TO_COST_CODES: dict[str, list[str]] = {
    "foundation_concrete": ["3100", "3000"],
    "framing":             ["3210", "3000"],
    "roofing":             ["3400"],
    "windows_doors":       ["3300", "3310"],
    "electrical":          ["3800", "3830"],
    "plumbing":            ["3600", "3610"],
    "hvac":                ["3700"],
    "insulation":          ["4700"],
    "drywall_finishes":    ["5000"],
    "exterior_finishes":   ["4600", "4100", "4110", "3500"],
    "excavation":          ["2000"],
    "site_prep":           ["2000", "1300"],
    "landscaping":         ["6200", "6310"],
    "garage":              ["4650"],
    "flooring":            ["5100", "5120", "5160", "5170"],
    "interior_finishes":   ["5200", "5400", "5211"],
    "appliances":          ["5900"],
    "cabinets":            ["5400", "5500"],
    "stairs":              ["3900"],
    "miscellaneous":       ["8200O", "8100O"],
}


def _resolve_cost_code(section: dict, biddable: dict) -> str | None:
    """
    Return the best cost_code for a section, checking:
    1. Explicit cost_code field (future takeoffs generated per spec)
    2. section_id mapping (current takeoffs from Claude extractor)
    Returns the first code that exists in the biddable map, or None.
    """
    explicit = section.get("cost_code", "")
    if explicit and explicit in biddable:
        return explicit

    section_id = section.get("section_id", "")
    for code in SECTION_TO_COST_CODES.get(section_id, []):
        if code in biddable:
            return code

    return None

app = FastAPI(title="Bid Generator", version="0.1.0")
app.add_middleware(CORSMiddleware,
    allow_origins=["https://oakleyapps.com", "http://localhost:3000"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

PM_ROLES = {"admin", "management", "pm"}


async def get_current_user(
    x_user_email: str = Header(default=""),
    x_user_role: str = Header(default="staff"),
    x_internal_secret: str = Header(default=""),
) -> dict:
    if x_internal_secret != INTERNAL_SERVICE_SECRET:
        raise HTTPException(status_code=401, detail="Unauthorized — missing internal secret")
    if not x_user_email:
        raise HTTPException(status_code=401, detail="Unauthorized — no user identity")
    return {"email": x_user_email, "role": x_user_role}


async def require_pm(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role", "staff") not in PM_ROLES:
        raise HTTPException(status_code=403, detail="Forbidden — PM or admin role required")
    return user


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


@app.get("/cost-codes")
async def list_cost_codes(user: dict = Depends(get_current_user)):
    return fs.list_biddable_cost_codes()


@app.get("/bids")
async def list_bids(user: dict = Depends(get_current_user)):
    return fs.list_all_bids()


@app.get("/bids/project/{project_id}")
async def list_project_bids(project_id: str, user: dict = Depends(get_current_user)):
    return fs.list_bids_for_project(project_id)


@app.get("/bids/project/{project_id}/setup")
async def get_project_bid_setup(project_id: str, user: dict = Depends(get_current_user)):
    """
    Return the cost codes + available vendors for a project's approved takeoff.
    Used by the frontend vendor-selection screen before generation.
    """
    takeoff = fs.get_approved_takeoff(project_id)
    if not takeoff:
        raise HTTPException(status_code=404, detail="No approved takeoff found for this project")

    biddable = {c["code_id"]: c for c in fs.list_biddable_cost_codes()}
    result = []

    for section in takeoff.get("sections", []):
        cost_code = _resolve_cost_code(section, biddable)
        if not cost_code:
            continue
        code_doc = biddable[cost_code]
        vendor_ids = code_doc.get("vendors", [])
        takeoff_items = section.get("items", [])

        vendors = []
        for vid in vendor_ids:
            vendor = fs.get_vendor(vid)
            if not vendor:
                continue
            categories = vendor.get("pricing_profile", {}).get("categories", {})
            line_count = len(categories.get(cost_code, {}))
            vendors.append({
                "vendor_id": vid,
                "vendor_name": vendor.get("name", vid),
                "line_item_count": line_count,
            })

        if vendors:
            result.append({
                "cost_code": cost_code,
                "cost_code_name": code_doc.get("name", ""),
                "takeoff_item_count": len(takeoff_items),
                "vendors": vendors,
            })

    return {
        "project_id": project_id,
        "project_name": takeoff.get("project_name", ""),
        "cost_codes": result,
    }


@app.post("/bids/project/{project_id}/generate", status_code=202)
async def generate_project_bids(
    project_id: str,
    body: GenerateBidsRequest = GenerateBidsRequest(),
    user: dict = Depends(require_pm),
):
    takeoff = fs.get_approved_takeoff(project_id)
    if not takeoff:
        raise HTTPException(status_code=400, detail="No approved takeoff found for this project")

    project = fs.get_project(project_id)
    project_name = takeoff.get("project_name") or (project.get("job_name", "") if project else "")
    biddable = {c["code_id"]: c for c in fs.list_biddable_cost_codes()}

    # Vendor selection override from request body (keyed by cost_code)
    selection: dict[str, list[str]] = body.selection or {}

    tasks = []
    bid_ids_created = []
    cost_codes_covered = set()
    vendors_invited = set()

    for section in takeoff.get("sections", []):
        cost_code = _resolve_cost_code(section, biddable)
        if not cost_code:
            continue
        code_doc = biddable[cost_code]
        # Use caller's selection if provided, else all vendors on the cost code
        vendor_ids = selection.get(cost_code) if selection else code_doc.get("vendors", [])
        takeoff_items = section.get("items", [])
        if not takeoff_items or not vendor_ids:
            continue
        cost_codes_covered.add(cost_code)

        for vendor_id in vendor_ids:
            vendor = fs.get_vendor(vendor_id)
            if not vendor:
                continue
            vendor_name = vendor.get("name", vendor_id)
            vendors_invited.add(vendor_id)
            bid_id = fs.create_bid(
                project_id=project_id, project_name=project_name,
                vendor_id=vendor_id, vendor_name=vendor_name,
                cost_code=cost_code, cost_code_name=code_doc.get("name", ""),
            )
            bid_ids_created.append(bid_id)
            tasks.append(_run_bid_generation(
                bid_id=bid_id, takeoff_items=takeoff_items,
                vendor_profile=vendor, cost_code=cost_code,
                cost_code_name=code_doc.get("name", ""), vendor_id=vendor_id,
            ))

    if tasks:
        asyncio.create_task(_gather_all(tasks))

    return {
        "project_id": project_id,
        "bids_created": len(bid_ids_created),
        "cost_codes_covered": sorted(cost_codes_covered),
        "vendors_invited": sorted(vendors_invited),
    }


async def _gather_all(tasks):
    await asyncio.gather(*tasks, return_exceptions=True)


async def _run_bid_generation(bid_id, takeoff_items, vendor_profile, cost_code, cost_code_name, vendor_id):
    try:
        result = await generate_bid(
            takeoff_items=takeoff_items, vendor_profile=vendor_profile,
            cost_code=cost_code, cost_code_name=cost_code_name, vendor_id=vendor_id,
        )
        line_items = result.get("line_items", [])
        for item in line_items:
            item.setdefault("takeoff_ref", "")
        fs.update_bid_with_result(bid_id, line_items, result.get("subtotal"), result.get("generation_notes"))
    except Exception as e:
        fs.update_bid_status_failed(bid_id, str(e))


@app.get("/bids/{bid_id}")
async def get_bid(bid_id: str, user: dict = Depends(get_current_user)):
    bid = fs.get_bid(bid_id)
    if not bid:
        raise HTTPException(status_code=404, detail="Bid not found")
    return bid


@app.patch("/bids/{bid_id}/line-items/{idx}")
async def update_line_item(bid_id: str, idx: int, body: LineItemUpdate, user: dict = Depends(require_pm)):
    updated = fs.update_line_item(bid_id, idx, body.unit_price, body.quantity, body.notes)
    if not updated:
        raise HTTPException(status_code=404, detail="Bid or line item not found")
    return {"status": "ok", "bid_id": bid_id, "idx": idx}


@app.post("/bids/{bid_id}/approve")
async def approve_bid_route(bid_id: str, user: dict = Depends(require_pm)):
    bid = fs.get_bid(bid_id)
    if not bid:
        raise HTTPException(status_code=404, detail="Bid not found")
    if bid.get("status") not in ("needs_review", "complete"):
        raise HTTPException(status_code=400, detail="Bid is not ready for approval")
    if not fs.approve_bid(bid_id, user.get("email", "")):
        raise HTTPException(status_code=404, detail="Bid not found")
    return {"status": "approved", "bid_id": bid_id}


@app.get("/bids/{bid_id}/pdf")
async def get_bid_pdf(bid_id: str, user: dict = Depends(get_current_user)):
    bid = fs.get_bid(bid_id)
    if not bid:
        raise HTTPException(status_code=404, detail="Bid not found")
    if bid.get("pdf_gcs_path"):
        try:
            return {"url": pdf.get_pdf_signed_url(bid["pdf_gcs_path"])}
        except Exception:
            pass
    project = fs.get_project(bid["project_id"]) or {}
    pdf_bytes = pdf.generate_bid_pdf(bid, project)
    gcs_path = pdf.upload_bid_pdf(bid["project_id"], bid["vendor_id"], bid["cost_code"], pdf_bytes)
    fs.update_bid_pdf_path(bid_id, gcs_path)
    return {"url": pdf.get_pdf_signed_url(gcs_path)}
