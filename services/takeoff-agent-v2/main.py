import json
import os
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import firestore_client as fs
import gcs_client as gcs
from agent_registry import AGENT_REGISTRY
from agents import get_agent
from airtable_client import AirtableClient
from dxf_processor import DXFProcessor
from estimate_parser import EstimateParseError, EstimateParser
from schemas import (
    AirtableProject,
    CreateFromAirtableRequest,
    GCSProject,
    SharedParams,
    V2Project,
)

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


# ── Project creation helpers ──────────────────────────────────────────────────


def _build_cost_code_docs(
    cost_codes_map: dict[str, dict],
    estimate_lines: dict[str, float] | None = None,
) -> list[dict]:
    """
    Build the cost_code sub-document list for a new v2 project.

    cost_codes_map: {full_code: firestore_doc} from apps/shared/cost_codes
    estimate_lines: optional {cost_code: final_cost} from estimate PDF or Airtable
    """
    docs = []
    for code, cc_doc in cost_codes_map.items():
        registry_entry = AGENT_REGISTRY.get(code, {})
        agent_type = registry_entry.get("agent_type", "manual_hold")
        is_profit = cc_doc.get("is_profit_item", False)
        if is_profit:
            agent_type = "skip"

        estimate_cost = estimate_lines.get(code) if estimate_lines else None

        docs.append(
            {
                "cost_code": code,
                "cost_code_name": cc_doc.get("name", ""),
                "category": cc_doc.get("category", ""),
                "is_profit_item": is_profit,
                "agent_type": agent_type,
                "agent_status": "pending",
                "estimate_final_cost": estimate_cost,
                "agent_run_id": None,
                "quantity": None,
                "unit": None,
                "output": None,
                "confidence": None,
                "source": None,
                "notes": None,
                "flags": [],
                "overrides": None,
                "override_notes": None,
                "override_by": None,
            }
        )
    return docs


# ── POST /v2/projects/from-airtable (8.2) ────────────────────────────────────


@app.post("/v2/projects/from-airtable", response_model=V2Project, status_code=201)
async def create_project_from_airtable(
    body: CreateFromAirtableRequest,
    user: dict = Depends(require_pm),
) -> V2Project:
    """
    Create a v2 project from an Airtable record.

    Fetches job metadata + estimate lines from Airtable, loads all cost codes
    from Firestore, then atomically writes shared/projects, vendy/v2_jobs, and
    all cost_codes sub-documents in a single batch.

    Returns 409 if the Airtable record is already in Vendy.
    Returns 503 if Airtable is unreachable.
    """
    record_id = body.airtable_record_id

    project_id = fs.make_slug(record_id)

    if fs.v2_project_exists(project_id):
        raise HTTPException(
            status_code=409,
            detail=f"Project with airtable_record_id '{record_id}' already exists in Vendy.",
        )

    client = AirtableClient()
    projects = client.get_contract_signed_projects()
    project_meta = next((p for p in projects if p["record_id"] == record_id), None)
    if project_meta is None:
        raise HTTPException(
            status_code=404,
            detail=f"Airtable record '{record_id}' not found or not Contract Signed.",
        )

    estimate_lines_raw = client.get_estimate_lines(record_id)
    estimate_lines: dict[str, float] = {
        line.cost_code: line.final_cost for line in estimate_lines_raw
    }

    job_name = project_meta["job_name"]
    project_id = fs.make_slug(job_name)

    if fs.v2_project_exists(project_id):
        raise HTTPException(
            status_code=409,
            detail=f"Project '{job_name}' already exists in Vendy.",
        )

    cost_codes_map = fs.get_all_cost_codes_map()
    cost_code_docs = _build_cost_code_docs(cost_codes_map, estimate_lines)

    estimate_pdf_gcs_path: str | None = None
    dxf_info = gcs.check_dxf_present(job_name)

    fs.create_v2_project_batch(
        project_id=project_id,
        job_name=job_name,
        address=project_meta.get("address", ""),
        project_source="airtable",
        cost_code_docs=cost_code_docs,
        created_by=user["email"],
        airtable_record_id=record_id,
        reference_home_ids=project_meta.get("reference_home_ids", []),
        estimate_pdf_gcs_path=estimate_pdf_gcs_path,
        dxf_present=dxf_info["dxf_present"],
        dxf_gcs_path=dxf_info.get("dxf_gcs_path"),
    )

    return V2Project(
        project_id=project_id,
        job_name=job_name,
        address=project_meta.get("address", ""),
        project_source="airtable",
        airtable_record_id=record_id,
        reference_home_ids=project_meta.get("reference_home_ids", []),
        dxf_present=dxf_info["dxf_present"],
        dxf_gcs_path=dxf_info.get("dxf_gcs_path"),
        created_by=user["email"],
    )


# ── POST /v2/projects/from-gcs (8.3) ─────────────────────────────────────────


@app.post("/v2/projects/from-gcs", response_model=V2Project, status_code=201)
async def create_project_from_gcs(
    folder_name: str = Form(...),
    estimate_pdf: UploadFile = File(...),
    corrected_lines: str = Form(default="[]"),
    user: dict = Depends(require_pm),
) -> V2Project:
    """
    Create a v2 project from a GCS folder.

    Accepts a folder name, an estimate PDF (uploaded and stored to GCS), and an
    optional JSON array of corrected estimate lines. Parses the PDF with
    EstimateParser; corrected_lines override parsed values for matching cost codes.

    Returns 422 with raw_extraction if the PDF cannot be parsed.
    Returns 409 if the project already exists in Vendy.
    """
    project_id = fs.make_slug(folder_name)

    if fs.v2_project_exists(project_id):
        raise HTTPException(
            status_code=409,
            detail=f"Project '{folder_name}' already exists in Vendy.",
        )

    pdf_bytes = await estimate_pdf.read()

    try:
        parsed_lines = EstimateParser().parse(pdf_bytes)
    except EstimateParseError as exc:
        raise HTTPException(
            status_code=422,
            detail={
                "message": str(exc),
                "raw_extraction": exc.raw_extraction,
            },
        )

    estimate_lines: dict[str, float] = {
        line.cost_code: line.final_cost for line in parsed_lines
    }

    try:
        overrides = json.loads(corrected_lines)
        for item in overrides:
            code = str(item.get("cost_code", "")).strip()
            cost = item.get("final_cost")
            if code and cost is not None:
                estimate_lines[code] = float(cost)
    except (json.JSONDecodeError, TypeError, ValueError):
        raise HTTPException(
            status_code=400,
            detail="corrected_lines must be a valid JSON array of {cost_code, final_cost} objects.",
        )

    estimate_pdf_gcs_path = gcs.upload_estimate_pdf(folder_name, pdf_bytes)

    dxf_info = gcs.check_dxf_present(folder_name)

    cost_codes_map = fs.get_all_cost_codes_map()
    cost_code_docs = _build_cost_code_docs(cost_codes_map, estimate_lines)

    fs.create_v2_project_batch(
        project_id=project_id,
        job_name=folder_name,
        address="",
        project_source="gcs",
        cost_code_docs=cost_code_docs,
        created_by=user["email"],
        estimate_pdf_gcs_path=estimate_pdf_gcs_path,
        dxf_present=dxf_info["dxf_present"],
        dxf_gcs_path=dxf_info.get("dxf_gcs_path"),
    )

    return V2Project(
        project_id=project_id,
        job_name=folder_name,
        address="",
        project_source="gcs",
        estimate_pdf_gcs_path=estimate_pdf_gcs_path,
        dxf_present=dxf_info["dxf_present"],
        dxf_gcs_path=dxf_info.get("dxf_gcs_path"),
        created_by=user["email"],
    )


# ── GET /v2/projects/{project_id}/dxf-status (9.2) ───────────────────────────


@app.get("/v2/projects/{project_id}/dxf-status")
async def get_dxf_status(
    project_id: str,
    user: dict = Depends(get_current_user),
) -> dict:
    """
    Return DXF presence and pre-processing status for a v2 project.
    Checks Firestore for the stored dxf_gcs_path, then confirms with GCS.
    """
    project = fs.get_v2_project(project_id)
    if project is None:
        raise HTTPException(
            status_code=404, detail=f"Project '{project_id}' not found."
        )

    # Re-check GCS in case DXF was uploaded after project was created
    job_name = project.get("job_name", project_id)
    dxf_info = gcs.check_dxf_present(job_name)

    return {
        "project_id": project_id,
        "dxf_present": dxf_info["dxf_present"],
        "dxf_gcs_path": dxf_info.get("dxf_gcs_path"),
        "preprocess_status": project.get("preprocess_status"),
    }


# ── POST /v2/projects/{project_id}/preprocess (9.2) ──────────────────────────


@app.post("/v2/projects/{project_id}/preprocess")
async def preprocess_project(
    project_id: str,
    user: dict = Depends(require_pm),
) -> dict:
    """
    Download the project DXF from GCS, run DXFProcessor.extract_shared_params(),
    write results to dxf_sections/shared_params, update preprocess_status,
    and log to apps/vendy/runs.

    Returns SharedParams + preprocess_status.
    Returns 404 if project not found.
    Returns 503 if no DXF file is present.
    """
    project = fs.get_v2_project(project_id)
    if project is None:
        raise HTTPException(
            status_code=404, detail=f"Project '{project_id}' not found."
        )

    job_name = project.get("job_name", project_id)
    dxf_gcs_path: str | None = project.get("dxf_gcs_path")

    if not dxf_gcs_path:
        dxf_info = gcs.check_dxf_present(job_name)
        if not dxf_info["dxf_present"]:
            fs.save_preprocess_result(project_id, {}, "failed")
            raise HTTPException(
                status_code=503,
                detail=f"No DXF file found for project '{project_id}'. "
                "Upload a DXF to GCS at projects/{job_name}/blueprints/ first.",
            )
        dxf_gcs_path = dxf_info["dxf_gcs_path"]

    started_at = datetime.now(timezone.utc)
    t0 = time.monotonic()
    tmp_path: str | None = None

    try:
        tmp_path = gcs.download_dxf_to_temp(dxf_gcs_path)
        processor = DXFProcessor(tmp_path)
        shared_params: SharedParams = processor.extract_shared_params()
    except Exception as exc:
        fs.save_preprocess_result(project_id, {}, "failed")
        fs.log_run(
            {
                "project_id": project_id,
                "run_type": "dxf_preprocess",
                "started_at": started_at,
                "completed_at": datetime.now(timezone.utc),
                "duration_ms": round((time.monotonic() - t0) * 1000),
                "status": "failed",
                "error": str(exc),
            }
        )
        raise HTTPException(
            status_code=500, detail=f"DXF processing failed: {exc}"
        ) from exc
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    params_dict = shared_params.model_dump()
    params_dict["dxf_gcs_path"] = dxf_gcs_path

    fs.save_preprocess_result(project_id, params_dict, "complete")

    run_id = fs.log_run(
        {
            "project_id": project_id,
            "run_type": "dxf_preprocess",
            "started_at": started_at,
            "completed_at": datetime.now(timezone.utc),
            "duration_ms": round((time.monotonic() - t0) * 1000),
            "status": "complete",
            "dxf_gcs_path": dxf_gcs_path,
            "confidence": shared_params.confidence,
            "layers_found": shared_params.layers_found,
            "layers_missing": shared_params.layers_missing,
            "flags": shared_params.flags,
        }
    )

    return {
        "project_id": project_id,
        "preprocess_status": "complete",
        "shared_params": params_dict,
        "run_id": run_id,
    }


# ── POST /v2/projects/{project_id}/run/{cost_code} (10.3) ────────────────────


@app.post("/v2/projects/{project_id}/run/{cost_code}")
async def run_agent(
    project_id: str,
    cost_code: str,
    user: dict = Depends(require_pm),
) -> dict:
    """
    Run the agent for a single cost code.

    Reads SharedParams from dxf_sections/shared_params, fetches vendor price books
    for historical_avg agents, downloads the DXF for requires_dxf agents, executes
    the agent, saves output to cost_codes/{cost_code}, and logs to apps/vendy/runs.

    agent_status in the response reflects the run outcome:
      complete         — agent ran and produced a result
      manual_required  — ManualHoldAgent; PM must enter value manually
      skipped          — SkipAgent; profit/non-takeoff item
      failed           — DXF missing / formula error / unhandled exception

    Returns 404 if the project or cost_code document is not found.
    Returns 409 if the project is locked.
    """
    project = fs.get_v2_project(project_id)
    if project is None:
        raise HTTPException(
            status_code=404, detail=f"Project '{project_id}' not found."
        )

    if project.get("locked"):
        raise HTTPException(
            status_code=409,
            detail=f"Project '{project_id}' is locked — unlock it before running agents.",
        )

    cc_doc = fs.get_cost_code_doc(project_id, cost_code)
    if cc_doc is None:
        raise HTTPException(
            status_code=404,
            detail=f"Cost code '{cost_code}' not found in project '{project_id}'.",
        )

    # Build SharedParams — fall back to zeros if preprocess has not run yet.
    shared_params_data = fs.get_shared_params(project_id) or {}
    shared_params_fields = set(SharedParams.model_fields.keys())
    filtered = {
        k: v for k, v in shared_params_data.items() if k in shared_params_fields
    }
    shared_params = SharedParams(**filtered)

    registry_entry = AGENT_REGISTRY.get(cost_code, {})
    agent_type_name: str = registry_entry.get("agent_type", "unknown")

    # Only fetch price books for historical_avg agents (avoids unnecessary reads).
    price_book_data: dict = {}
    if agent_type_name == "historical_avg":
        price_book_data = fs.get_vendor_price_books(cost_code)

    # ── DXF download for requires_dxf agents ─────────────────────────────────
    requires_dxf: bool = registry_entry.get("requires_dxf", False)
    dxf_local_path: str | None = None
    tmp_dxf: str | None = None

    if requires_dxf:
        dxf_gcs_path: str | None = project.get("dxf_gcs_path")
        if not dxf_gcs_path:
            dxf_info = gcs.check_dxf_present(project.get("job_name", project_id))
            dxf_gcs_path = dxf_info.get("dxf_gcs_path")

        if not dxf_gcs_path:
            # No DXF available — fail without running the agent.
            unit = registry_entry.get("agent_config", {}).get("unit")
            output_dict = {
                "quantity": None,
                "unit": unit,
                "output": None,
                "source": agent_type_name,
                "confidence": "low",
                "notes": "DXF required but no DXF file found for this project.",
                "flags": ["dxf_required_but_not_present"],
            }
            run_id = fs.log_run(
                {
                    "project_id": project_id,
                    "cost_code": cost_code,
                    "run_type": "agent_run",
                    "agent_type": agent_type_name,
                    "started_at": datetime.now(timezone.utc),
                    "completed_at": datetime.now(timezone.utc),
                    "duration_ms": 0,
                    "status": "failed",
                    "agent_status": "failed",
                    "flags": ["dxf_required_but_not_present"],
                    "triggered_by": user["email"],
                }
            )
            fs.save_agent_output(project_id, cost_code, output_dict, run_id, "failed")
            return {
                "project_id": project_id,
                "cost_code": cost_code,
                "agent_status": "failed",
                "run_id": run_id,
                "agent_output": output_dict,
            }

        try:
            tmp_dxf = gcs.download_dxf_to_temp(dxf_gcs_path)
            dxf_local_path = tmp_dxf
        except Exception as exc:
            unit = registry_entry.get("agent_config", {}).get("unit")
            flag = f"dxf_download_failed:{exc!s}"
            output_dict = {
                "quantity": None,
                "unit": unit,
                "output": None,
                "source": agent_type_name,
                "confidence": "low",
                "notes": f"Failed to download DXF: {exc}",
                "flags": [flag],
            }
            run_id = fs.log_run(
                {
                    "project_id": project_id,
                    "cost_code": cost_code,
                    "run_type": "agent_run",
                    "agent_type": agent_type_name,
                    "started_at": datetime.now(timezone.utc),
                    "completed_at": datetime.now(timezone.utc),
                    "duration_ms": 0,
                    "status": "failed",
                    "agent_status": "failed",
                    "flags": [flag],
                    "triggered_by": user["email"],
                }
            )
            fs.save_agent_output(project_id, cost_code, output_dict, run_id, "failed")
            return {
                "project_id": project_id,
                "cost_code": cost_code,
                "agent_status": "failed",
                "run_id": run_id,
                "agent_output": output_dict,
            }

    # ── Run the agent ─────────────────────────────────────────────────────────
    agent = get_agent(cost_code)
    started_at = datetime.now(timezone.utc)
    t0 = time.monotonic()

    try:
        result = agent.run(
            shared_params, price_book_data, dxf_local_path=dxf_local_path
        )
    except Exception as exc:
        run_id = fs.log_run(
            {
                "project_id": project_id,
                "cost_code": cost_code,
                "run_type": "agent_run",
                "agent_type": agent_type_name,
                "started_at": started_at,
                "completed_at": datetime.now(timezone.utc),
                "duration_ms": round((time.monotonic() - t0) * 1000),
                "status": "failed",
                "error": str(exc),
                "triggered_by": user["email"],
            }
        )
        fs.save_agent_output(project_id, cost_code, {}, run_id, "failed")
        raise HTTPException(status_code=500, detail=f"Agent run failed: {exc}") from exc
    finally:
        if tmp_dxf and os.path.exists(tmp_dxf):
            os.unlink(tmp_dxf)

    completed_at = datetime.now(timezone.utc)
    duration_ms = round((time.monotonic() - t0) * 1000)
    output_dict = result.model_dump()

    # Resolve agent_status from result signals.
    flags_str = " ".join(result.flags)
    if result.source == "manual":
        agent_status = "manual_required"
    elif result.source == "skip":
        agent_status = "skipped"
    elif (
        "formula_eval_error" in flags_str
        or "agent_type_not_implemented" in flags_str
        or "dxf_required_but_not_present" in flags_str
    ):
        agent_status = "failed"
    else:
        agent_status = "complete"

    log_entry: dict = {
        "project_id": project_id,
        "cost_code": cost_code,
        "run_type": "agent_run",
        "agent_type": agent_type_name,
        "started_at": started_at,
        "completed_at": completed_at,
        "duration_ms": duration_ms,
        "status": "complete",
        "agent_status": agent_status,
        "confidence": result.confidence,
        "source": result.source,
        "flags": result.flags,
        "triggered_by": user["email"],
    }
    # project_flag agents call Claude — log token usage for audit.
    if result.source == "project_flag" and result.output:
        log_entry["uses_claude"] = True
        log_entry["input_tokens"] = result.output.get("input_tokens")
        log_entry["output_tokens"] = result.output.get("output_tokens")
        log_entry["model"] = result.output.get("model")

    run_id = fs.log_run(log_entry)

    fs.save_agent_output(project_id, cost_code, output_dict, run_id, agent_status)

    return {
        "project_id": project_id,
        "cost_code": cost_code,
        "agent_status": agent_status,
        "run_id": run_id,
        "agent_output": output_dict,
    }
