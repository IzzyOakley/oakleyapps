import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import Depends, FastAPI, File, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import firestore_client as fs
import gcs_client as gcs
import notes_analyzer
import pdf_client as pdf
from bid_builder import (
    SECTION_TO_COST_CODES,
    _resolve_cost_code,
    process_approved_takeoff,
)
from generator import generate_bid
from schemas import LineItemUpdate, GenerateBidsRequest

logger = logging.getLogger(__name__)

INTERNAL_SERVICE_SECRET = os.environ.get(
    "INTERNAL_SERVICE_SECRET", "oakley-internal-dev"
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.environ.get("ENVIRONMENT") == "production":
        import pubsub_subscriber
        logger.info("Starting Pub/Sub subscriber thread")
        pubsub_subscriber.start_subscriber(process_approved_takeoff)
    yield


app = FastAPI(title="Bid Generator", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://oakleyapps.com", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

PM_ROLES = {"admin", "management", "pm"}


async def get_current_user(
    x_user_email: str = Header(default=""),
    x_user_role: str = Header(default="staff"),
    x_internal_secret: str = Header(default=""),
) -> dict:
    if x_internal_secret != INTERNAL_SERVICE_SECRET:
        raise HTTPException(
            status_code=401, detail="Unauthorized — missing internal secret"
        )
    if not x_user_email:
        raise HTTPException(status_code=401, detail="Unauthorized — no user identity")
    return {"email": x_user_email, "role": x_user_role}


async def require_pm(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role", "staff") not in PM_ROLES:
        raise HTTPException(
            status_code=403, detail="Forbidden — PM or admin role required"
        )
    return user


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


@app.post("/process/{project_id}", status_code=202)
async def trigger_bid_generation(
    project_id: str, user: dict = Depends(require_pm)
):
    """
    Manual trigger for bid generation — same logic as the Pub/Sub path.
    Useful for re-processing or testing without sending a Pub/Sub message.
    """
    asyncio.create_task(process_approved_takeoff(project_id))
    return {"project_id": project_id, "status": "processing"}


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
async def get_project_bid_setup(
    project_id: str, user: dict = Depends(get_current_user)
):
    """
    Return the cost codes + available vendors for a project's approved takeoff.
    Used by the frontend vendor-selection screen before generation.
    """
    takeoff = fs.get_approved_takeoff(project_id)
    if not takeoff:
        raise HTTPException(
            status_code=404, detail="No approved takeoff found for this project"
        )

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
            vendors.append(
                {
                    "vendor_id": vid,
                    "vendor_name": vendor.get("name", vid),
                    "line_item_count": line_count,
                }
            )

        if vendors:
            result.append(
                {
                    "cost_code": cost_code,
                    "cost_code_name": code_doc.get("name", ""),
                    "takeoff_item_count": len(takeoff_items),
                    "vendors": vendors,
                }
            )

    return {
        "project_id": project_id,
        "project_name": takeoff.get("project_name", ""),
        "cost_codes": result,
    }


@app.get("/bids/project/{project_id}/notes-status")
async def get_project_notes_status(
    project_id: str, user: dict = Depends(get_current_user)
):
    """
    Check whether a project notes PDF exists in GCS for this project.
    Looks in: projects/{job_name}/project-notes/*.pdf
    """
    project = fs.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    job_name = project.get("job_name", project_id)
    gcs_path = gcs.find_project_notes(job_name)
    filename = gcs_path.rsplit("/", 1)[-1] if gcs_path else None
    return {"found": gcs_path is not None, "gcs_path": gcs_path, "filename": filename}


@app.post("/bids/project/{project_id}/notes", status_code=201)
async def upload_project_notes(
    project_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(require_pm),
):
    """Upload a project notes PDF to GCS for this project."""
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")
    project = fs.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    job_name = project.get("job_name", project_id)
    data = await file.read()
    gcs_path = gcs.upload_project_notes(job_name, file.filename, data)
    return {"gcs_path": gcs_path, "filename": file.filename, "job_name": job_name}


@app.post("/bids/project/{project_id}/generate", status_code=202)
async def generate_project_bids(
    project_id: str,
    body: GenerateBidsRequest = GenerateBidsRequest(),
    user: dict = Depends(require_pm),
):
    takeoff = fs.get_approved_takeoff(project_id)
    if not takeoff:
        raise HTTPException(
            status_code=400, detail="No approved takeoff found for this project"
        )

    project = fs.get_project(project_id)
    project_name = takeoff.get("project_name") or (
        project.get("job_name", "") if project else ""
    )
    biddable = {c["code_id"]: c for c in fs.list_biddable_cost_codes()}

    # Resolve project notes context if a GCS path was provided
    notes_context: dict | None = None
    if body.notes_gcs_path:
        try:
            pdf_bytes = gcs.download_bytes(body.notes_gcs_path)
            notes_context = await notes_analyzer.analyze_project_notes(
                pdf_bytes, project_name
            )
            logger.info(
                "project notes analyzed project=%s summary=%s",
                project_id,
                notes_context.get("summary", "")[:100],
            )
        except Exception as exc:
            logger.warning("notes analysis failed project=%s: %s", project_id, exc)

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
        vendor_ids = (
            selection.get(cost_code) if selection else code_doc.get("vendors", [])
        )
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
                project_id=project_id,
                project_name=project_name,
                vendor_id=vendor_id,
                vendor_name=vendor_name,
                cost_code=cost_code,
                cost_code_name=code_doc.get("name", ""),
            )
            bid_ids_created.append(bid_id)
            tasks.append(
                _run_bid_generation(
                    bid_id=bid_id,
                    takeoff_items=takeoff_items,
                    vendor_profile=vendor,
                    cost_code=cost_code,
                    cost_code_name=code_doc.get("name", ""),
                    vendor_id=vendor_id,
                    notes_context=notes_context,
                )
            )

    if tasks:
        asyncio.create_task(_gather_all(tasks))

    return {
        "project_id": project_id,
        "bids_created": len(bid_ids_created),
        "cost_codes_covered": sorted(cost_codes_covered),
        "vendors_invited": sorted(vendors_invited),
        "notes_analyzed": notes_context is not None,
    }


async def _gather_all(tasks):
    await asyncio.gather(*tasks, return_exceptions=True)


async def _run_bid_generation(
    bid_id, takeoff_items, vendor_profile, cost_code, cost_code_name, vendor_id,
    notes_context: dict | None = None,
):
    try:
        result = await generate_bid(
            takeoff_items=takeoff_items,
            vendor_profile=vendor_profile,
            cost_code=cost_code,
            cost_code_name=cost_code_name,
            vendor_id=vendor_id,
            notes_context=notes_context,
        )
        line_items = result.get("line_items", [])
        for item in line_items:
            item.setdefault("takeoff_ref", "")
        fs.update_bid_with_result(
            bid_id, line_items, result.get("subtotal"), result.get("generation_notes")
        )
    except Exception as e:
        fs.update_bid_status_failed(bid_id, str(e))


@app.get("/bids/{bid_id}")
async def get_bid(bid_id: str, user: dict = Depends(get_current_user)):
    bid = fs.get_bid(bid_id)
    if not bid:
        raise HTTPException(status_code=404, detail="Bid not found")
    return bid


@app.patch("/bids/{bid_id}/line-items/{idx}")
async def update_line_item(
    bid_id: str, idx: int, body: LineItemUpdate, user: dict = Depends(require_pm)
):
    updated = fs.update_line_item(
        bid_id, idx, body.unit_price, body.quantity, body.notes
    )
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
    from fastapi.responses import Response as FastAPIResponse

    bid = fs.get_bid(bid_id)
    if not bid:
        raise HTTPException(status_code=404, detail="Bid not found")

    project = fs.get_project(bid["project_id"]) or {}
    version = bid.get("version", 1)
    pdf_bytes = pdf.generate_bid_pdf(bid, project, version=version)

    vendor_slug = (bid.get("vendor_name") or "vendor").replace(" ", "_").lower()
    project_slug = (bid.get("project_name") or "project").replace(" ", "_").lower()
    filename = f"bid_{project_slug}_{vendor_slug}_v{version}.pdf"

    return FastAPIResponse(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "no-store",
        },
    )
