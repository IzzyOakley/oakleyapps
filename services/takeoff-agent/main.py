import asyncio
import os
from datetime import datetime, timezone
from pathlib import Path

# Load .env file before anything else so GOOGLE_APPLICATION_CREDENTIALS etc. are set
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import firestore_client as fs
import gcs_client as gcs
import pubsub_client as ps
from schemas import (
    CreateProjectRequest,
    UpdateItemRequest,
    CreateVendorRequest,
    UpdateVendorRequest,
    CreateCostCodeRequest,
)

# ── Internal service secret ──────────────────────────────────────────────────
# All requests originate from the Next.js proxy which has already verified the
# Firebase session cookie. We authenticate internal traffic with a shared
# secret header rather than a second JWT round-trip.
INTERNAL_SERVICE_SECRET = os.environ.get(
    "INTERNAL_SERVICE_SECRET", "oakley-internal-dev"
)

# ── App ──────────────────────────────────────────────────────────────────────
app = FastAPI(title="Takeoff Agent", version="0.1.0")

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
    """
    Trust the user identity set by the Next.js proxy layer.
    The proxy verifies the Firebase session cookie before forwarding —
    this service is not directly reachable from the public internet.
    """
    if x_internal_secret != INTERNAL_SERVICE_SECRET:
        raise HTTPException(
            status_code=401, detail="Unauthorized — missing internal secret"
        )
    if not x_user_email:
        raise HTTPException(status_code=401, detail="Unauthorized — no user identity")
    return {"email": x_user_email, "role": x_user_role}


async def require_pm(user: dict = Depends(get_current_user)) -> dict:
    role = user.get("role", "staff")
    if role not in PM_ROLES:
        raise HTTPException(
            status_code=403, detail="Forbidden — PM or admin role required"
        )
    return user


async def require_management(user: dict = Depends(get_current_user)) -> dict:
    role = user.get("role", "staff")
    if role not in {"admin", "management"}:
        raise HTTPException(
            status_code=403, detail="Forbidden — management or admin role required"
        )
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden — admin role required")
    return user


# ── Health ───────────────────────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok", "version": "0.1.0"}


# ── Projects ─────────────────────────────────────────────────────────────────


@app.get("/projects")
async def list_projects(user: dict = Depends(get_current_user)) -> list[dict]:
    import re

    # ── Firestore projects (keyed by project_id) ─────────────────────────────
    fs_projects = {p["project_id"]: p for p in fs.list_projects()}

    # ── GCS folders — single-pass scan ───────────────────────────────────────
    try:
        gcs_scan = gcs.scan_all_projects_cached()  # {folder_name: pdf_path_or_None}
    except Exception:
        gcs_scan = {}

    # ── Build a merged project_id → record dict ───────────────────────────────
    merged: dict[str, dict] = {}

    # Seed from GCS so every real project folder appears
    for folder_name, pdf_path in gcs_scan.items():
        if folder_name == "test-project-001":
            continue  # skip test scaffold
        project_id = re.sub(r"[^a-z0-9]+", "_", folder_name.lower()).strip("_")
        merged[project_id] = {
            "project_id": project_id,
            "job_name": folder_name,
            "address": "",
            "status": "open",
            "has_blueprint": pdf_path is not None,
            "blueprint_gcs_path": pdf_path,
            "flags": {},
            "_from_gcs": True,
        }

    # Overlay / replace with richer Firestore data where it exists
    for project_id, p in fs_projects.items():
        if project_id == "_schema":
            continue
        entry = merged.get(project_id, {})
        entry.update(
            {
                "project_id": project_id,
                "job_name": p.get("job_name") or entry.get("job_name", ""),
                "address": p.get("address") or entry.get("address", ""),
                "status": p.get("status", "open"),
                "has_blueprint": bool(p.get("blueprint_gcs_path"))
                or entry.get("has_blueprint", False),
                "blueprint_gcs_path": p.get("blueprint_gcs_path")
                or entry.get("blueprint_gcs_path"),
                "flags": p.get("flags") or {},
                "_from_gcs": False,
            }
        )
        merged[project_id] = entry

    # ── Attach job status (batch query — one round-trip for all projects) ──────
    # Only query projects that have Firestore records (not pure GCS-only stubs)
    fs_project_ids = [pid for pid, p in merged.items() if not p.get("_from_gcs")]
    jobs_by_project = fs.list_jobs_by_projects(fs_project_ids)

    result = []
    for project_id, p in merged.items():
        job = jobs_by_project.get(project_id) if not p.get("_from_gcs") else None
        takeoff_status = _derive_takeoff_status(p, job)
        result.append(
            {
                "project_id": project_id,
                "job_name": p["job_name"],
                "address": p["address"],
                "status": p["status"],
                "has_blueprint": p["has_blueprint"],
                "takeoff_status": takeoff_status,
                "takeoff_job_id": job["job_id"] if job else None,
                "flags": p["flags"],
            }
        )

    # Sort: jobs with activity first, then alphabetically
    result.sort(key=lambda x: (x["takeoff_status"] == "none", x["job_name"].lower()))
    return result


@app.get("/projects/{project_id}")
async def get_project(project_id: str, user: dict = Depends(get_current_user)) -> dict:
    import re

    project = fs.get_project(project_id)

    # Auto-register on first visit if project only exists in GCS
    if not project:
        try:
            gcs_scan = gcs.scan_all_projects_cached()
            for folder_name, pdf_path in gcs_scan.items():
                slug = re.sub(r"[^a-z0-9]+", "_", folder_name.lower()).strip("_")
                if slug == project_id:
                    new_id = fs.create_project(folder_name, "")
                    if pdf_path:
                        fs.update_project_blueprint(new_id, pdf_path)
                    project = fs.get_project(new_id)
                    break
        except Exception:
            pass

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    job = fs.get_latest_job_for_project(project_id)
    return {
        **project,
        "has_blueprint": bool(project.get("blueprint_gcs_path")),
        "takeoff_status": _derive_takeoff_status(project, job),
        "latest_job": job,
    }


@app.post("/projects", status_code=201)
async def create_project(
    body: CreateProjectRequest, user: dict = Depends(require_pm)
) -> dict:
    project_id = fs.create_project(body.job_name, body.address)
    return {"project_id": project_id}


@app.post("/projects/{project_id}/blueprints")
async def upload_blueprint(
    project_id: str,
    file: UploadFile = File(...),
    user: dict = Depends(get_current_user),
) -> dict:
    project = fs.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    data = await file.read()
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    gcs_path = gcs.upload_blueprint(project["job_name"], file.filename, data)
    fs.update_project_blueprint(project_id, gcs_path)
    return {"gcs_path": gcs_path}


@app.get("/projects/{project_id}/blueprint-pages")
async def get_blueprint_pages(
    project_id: str, user: dict = Depends(get_current_user)
) -> dict:
    import re

    project = fs.get_project(project_id)

    # Auto-register GCS-discovered project on first visit
    if not project:
        try:
            gcs_scan = gcs.scan_all_projects_cached()
            for folder_name, pdf_path in gcs_scan.items():
                slug = re.sub(r"[^a-z0-9]+", "_", folder_name.lower()).strip("_")
                if slug == project_id:
                    new_id = fs.create_project(folder_name, "")
                    if pdf_path:
                        fs.update_project_blueprint(new_id, pdf_path)
                    project = fs.get_project(new_id)
                    break
        except Exception:
            pass

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    gcs_path = project.get("blueprint_gcs_path")
    if not gcs_path:
        raise HTTPException(
            status_code=404, detail="No blueprint uploaded for this project"
        )

    resolved = gcs.resolve_blueprint_path(project["job_name"], gcs_path)
    if not resolved:
        raise HTTPException(
            status_code=404, detail="Blueprint file not found in storage"
        )

    pages = gcs.get_blueprint_page_images(resolved, project["job_name"])
    return {"pages": pages}


@app.post("/projects/{project_id}/takeoff", status_code=202)
async def start_takeoff(
    project_id: str,
    request: Request,
    user: dict = Depends(require_pm),
) -> dict:
    import re

    project = fs.get_project(project_id)

    # Auto-register GCS-discovered projects on first interaction
    if not project:
        gcs_scan = gcs.scan_all_projects_cached()
        # Try to find a matching folder by slugified name
        for folder_name, pdf_path in gcs_scan.items():
            slug = re.sub(r"[^a-z0-9]+", "_", folder_name.lower()).strip("_")
            if slug == project_id and pdf_path:
                new_id = fs.create_project(folder_name, "")
                fs.update_project_blueprint(new_id, pdf_path)
                project = fs.get_project(new_id)
                break

    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    if not project.get("blueprint_gcs_path"):
        raise HTTPException(
            status_code=400, detail="No blueprint uploaded — upload a PDF first"
        )

    job_id = fs.create_job(project_id, user.get("email", ""))

    # Fire and forget — run extraction in background
    asyncio.create_task(_run_extraction(job_id, project))

    return {"job_id": job_id, "status": "processing"}


async def _run_extraction(job_id: str, project: dict) -> None:
    try:
        await asyncio.to_thread(run_takeoff_sync, job_id, project)
    except Exception:
        pass  # errors already written to Firestore by run_takeoff


def run_takeoff_sync(job_id: str, project: dict) -> None:
    """Sync wrapper for extractor since extractor uses sync anthropic client."""
    from extractor import run_takeoff as _run
    import asyncio as _asyncio

    loop = _asyncio.new_event_loop()
    try:
        loop.run_until_complete(_run(job_id, project))
    finally:
        loop.close()


# ── Jobs ──────────────────────────────────────────────────────────────────────


@app.get("/jobs/{job_id}")
async def get_job(job_id: str, user: dict = Depends(get_current_user)) -> dict:
    job = fs.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@app.patch("/jobs/{job_id}/items/{item_id}")
async def update_item(
    job_id: str,
    item_id: str,
    body: UpdateItemRequest,
    user: dict = Depends(require_pm),
) -> dict:
    if body.status not in ("confirmed", "overridden"):
        raise HTTPException(
            status_code=400, detail="status must be 'confirmed' or 'overridden'"
        )

    updated = fs.update_item_in_job(
        job_id, item_id, body.pm_override, body.notes, body.status
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Job or item not found")

    return {"status": "ok", "job_id": job_id, "item_id": item_id}


@app.post("/jobs/{job_id}/approve")
async def approve_job(job_id: str, user: dict = Depends(require_pm)) -> dict:
    job = fs.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.get("status") not in ("complete", "needs_approval"):
        raise HTTPException(status_code=400, detail="Job is not ready for approval")

    takeoff_data = job.get("takeoff_data") or {}
    sections = takeoff_data.get("sections", [])

    # Validate all flagged items are resolved
    unresolved = [
        i["item_id"]
        for s in sections
        for i in s.get("items", [])
        if i.get("flagged") and i.get("status") == "flagged"
    ]
    if unresolved:
        raise HTTPException(
            status_code=400,
            detail=f"{len(unresolved)} flagged items still need input",
        )

    # Extract project_id from project_ref
    project_ref: str = job.get("project_ref", "")
    project_id = project_ref.split("/")[-1]
    project = fs.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    approved_by = user.get("email", "")
    approved_at = datetime.now(timezone.utc).isoformat()

    # Write approved takeoff to shared collection
    fs.write_approved_takeoff(project_id, job_id, project, takeoff_data, approved_by)
    fs.update_job_status(job_id, "complete")

    # Publish Pub/Sub event
    try:
        ps.publish_takeoff_approved(
            project_id=project_id,
            job_id=job_id,
            project_name=project.get("job_name", ""),
            address=project.get("address", ""),
            approved_by=approved_by,
            approved_at=approved_at,
            summary=takeoff_data.get("summary", {}),
        )
    except Exception:
        pass  # Don't fail approval if Pub/Sub publish fails

    return {"status": "approved", "project_id": project_id, "job_id": job_id}


# ── Vendors ──────────────────────────────────────────────────────────────────


@app.get("/vendors")
async def list_vendors(
    active: bool | None = None,
    user: dict = Depends(get_current_user),
) -> list[dict]:
    vendors = fs.list_vendors(active_only=active is True)
    if not vendors:
        return []
    # Single pass over cost_codes collection — no N+1 queries
    all_slugs = [v["vendor_id"] for v in vendors]
    cost_codes_map = fs.list_cost_codes_for_vendors(all_slugs)
    result = []
    for v in vendors:
        slug = v["vendor_id"]
        result.append(
            {
                "vendor_id": slug,
                "name": v.get("name", ""),
                "trade": v.get("trade", ""),
                "contact_email": v.get("contact_email", ""),
                "bid_format": v.get("bid_format", "itemized"),
                "active": v.get("active", True),
                "bids_processed": (v.get("price_book") or {}).get("bids_processed", 0),
                "price_book_last_updated": (v.get("price_book") or {}).get(
                    "last_updated"
                ),
                "cost_codes": cost_codes_map.get(slug, []),
            }
        )
    result.sort(key=lambda v: v["name"].lower())
    return result


@app.get("/vendors/{slug}")
async def get_vendor(slug: str, user: dict = Depends(get_current_user)) -> dict:
    vendor = fs.get_vendor_full(slug)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    # Normalise active — legacy docs may not have the field; default is True
    vendor.setdefault("active", True)
    # Attach cost codes from shared collection
    vendor["cost_codes"] = fs.list_cost_codes_for_vendor(slug)
    return vendor


@app.post("/vendors", status_code=201)
async def create_vendor(
    body: CreateVendorRequest,
    user: dict = Depends(require_management),
) -> dict:
    try:
        slug = fs.create_vendor(
            body.name, body.trade, body.contact_email, body.bid_format
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"vendor_id": slug}


@app.patch("/vendors/{slug}")
async def update_vendor(
    slug: str,
    body: UpdateVendorRequest,
    user: dict = Depends(require_management),
) -> dict:
    updates = {}
    if body.active is not None:
        updates["active"] = body.active
    if body.name is not None:
        updates["name"] = body.name.strip()
    if body.trade is not None:
        updates["trade"] = body.trade.strip()
    if body.contact_email is not None:
        updates["contact_email"] = body.contact_email.strip()
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    updated = fs.update_vendor(slug, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return {"vendor_id": slug, **updates}


@app.get("/vendors/{slug}/bid-ledger")
async def get_vendor_bid_ledger(
    slug: str,
    page: int = 1,
    outcome: str | None = None,
    user: dict = Depends(get_current_user),
) -> dict:
    vendor = fs.get_vendor_full(slug)
    if not vendor:
        raise HTTPException(status_code=404, detail="Vendor not found")
    if outcome and outcome not in ("awarded", "not_awarded"):
        raise HTTPException(
            status_code=400, detail="outcome must be 'awarded' or 'not_awarded'"
        )
    return fs.list_vendor_bid_ledger(slug, page=page, outcome=outcome)


# ── Cost Codes ────────────────────────────────────────────────────────────────


@app.post("/cost-codes", status_code=201)
async def create_cost_code(
    body: CreateCostCodeRequest,
    user: dict = Depends(require_admin),
) -> dict:
    try:
        code = fs.create_cost_code(body.full_code, body.name, body.category)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"full_code": code}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _derive_takeoff_status(project: dict, job: dict | None) -> str:
    if not job:
        return "none"
    status = job.get("status", "")
    if status in ("pending", "processing"):
        # Timeout: if stuck for more than 15 minutes, mark as failed in Firestore
        # so the badge clears immediately on the next poll
        created_at = job.get("created_at")
        if created_at:
            try:
                age = (datetime.now(timezone.utc) - created_at).total_seconds()
                if age > 900:  # 15 minutes
                    try:
                        fs.update_job_status(
                            job["job_id"], "failed", error="Timed out after 15 minutes"
                        )
                    except Exception:
                        pass
                    return "none"
            except Exception:
                pass
        return "processing"
    if status == "failed":
        return "none"
    # Check if approved takeoff exists
    try:
        project_id = project.get("project_id", "")
        db = fs.get_db()
        doc = (
            db.collection("apps")
            .document("shared")
            .collection("takeoffs")
            .document(project_id)
            .get()
        )
        if doc.exists:
            return "approved"
    except Exception:
        pass
    if status == "complete":
        return "needs_approval"
    return "none"
