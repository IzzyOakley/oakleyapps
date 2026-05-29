import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import firestore_client as fs
import gcs_client as gcs
from airtable_client import AirtableClient
from schemas import AirtableProject, GCSProject

INTERNAL_SERVICE_SECRET = os.environ.get(
    "INTERNAL_SERVICE_SECRET", "oakley-internal-dev"
)

PM_ROLES = {"admin", "management", "pm"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    fs.get_db()
    gcs.get_client()
    yield


app = FastAPI(title="Takeoff Agent v2", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://oakleyapps.com", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth ──────────────────────────────────────────────────────────────────────


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


async def require_management(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role", "staff") not in {"admin", "management"}:
        raise HTTPException(
            status_code=403, detail="Forbidden — management or admin role required"
        )
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Forbidden — admin role required")
    return user


# ── Health ────────────────────────────────────────────────────────────────────


@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0"}


# ── Airtable project picker ───────────────────────────────────────────────────


@app.get("/v2/airtable/projects", response_model=list[AirtableProject])
async def list_airtable_projects(
    user: dict = Depends(require_pm),
) -> list[AirtableProject]:
    """
    Return Contract Signed projects from Airtable, excluding any already in Vendy.
    Also returns estimate_line_count so the UI can show the PM how many cost codes
    are available before they confirm the import.
    """
    client = AirtableClient()
    projects = client.get_contract_signed_projects()

    existing_ids = fs.get_existing_v2_project_airtable_ids()

    result = []
    for p in projects:
        if p["record_id"] in existing_ids:
            continue
        try:
            lines = client.get_estimate_lines(p["record_id"])
        except HTTPException:
            lines = []
        result.append(
            AirtableProject(
                record_id=p["record_id"],
                job_name=p["job_name"],
                address=p.get("address", ""),
                reference_home_ids=p.get("reference_home_ids", []),
                estimate_line_count=len(lines),
            )
        )
    return result


# ── GCS project listing ───────────────────────────────────────────────────────


@app.get("/v2/gcs/projects", response_model=list[GCSProject])
async def list_gcs_projects(user: dict = Depends(require_pm)) -> list[GCSProject]:
    """
    Return GCS project folders that are not yet in Vendy v2.
    Each folder entry includes flags for DXF, PDF, and estimate PDF presence.
    """
    folders = gcs.list_project_folders()
    existing_names = fs.get_existing_v2_project_job_names()
    return [f for f in folders if f.folder_name not in existing_names]
