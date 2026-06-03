import os
import re
import uuid
from datetime import datetime, timezone

from google.cloud import firestore

_db: firestore.Client | None = None


def get_db() -> firestore.Client:
    global _db
    if _db is None:
        project = os.environ.get("FIREBASE_PROJECT_ID", "buildertrend-pipeline")
        _db = firestore.Client(project=project)
    return _db


def get_existing_v2_project_airtable_ids() -> set[str]:
    """Return set of airtable_record_ids already in Vendy v2_jobs."""
    db = get_db()
    docs = db.collection("apps").document("vendy").collection("v2_jobs").stream()
    result: set[str] = set()
    for doc in docs:
        data = doc.to_dict() or {}
        record_id = data.get("airtable_record_id")
        if record_id:
            result.add(record_id)
    return result


def get_existing_v2_project_job_names() -> set[str]:
    """Return set of job_names already in Vendy v2_jobs (for GCS cross-check)."""
    db = get_db()
    docs = db.collection("apps").document("vendy").collection("v2_jobs").stream()
    return {(doc.to_dict() or {}).get("job_name", "") for doc in docs}


def v2_project_exists(project_id: str) -> bool:
    db = get_db()
    doc = (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
        .get()
    )
    return doc.exists


def get_all_cost_codes_map() -> dict[str, dict]:
    """Return {full_code: doc_dict} for all apps/shared/cost_codes documents."""
    db = get_db()
    docs = db.collection("apps").document("shared").collection("cost_codes").stream()
    return {doc.id: (doc.to_dict() or {}) for doc in docs}


def make_slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")


def create_v2_project_batch(
    project_id: str,
    job_name: str,
    address: str,
    project_source: str,
    cost_code_docs: list[dict],
    created_by: str,
    airtable_record_id: str | None = None,
    reference_home_ids: list[str] | None = None,
    estimate_pdf_gcs_path: str | None = None,
    dxf_present: bool = False,
    dxf_gcs_path: str | None = None,
    estimate_sf: float | None = None,
) -> None:
    """
    Atomically write apps/shared/projects, apps/vendy/v2_jobs,
    and all cost_codes sub-documents in a single Firestore batch.
    """
    db = get_db()
    now = datetime.now(timezone.utc)
    batch = db.batch()

    # apps/shared/projects/{project_id}
    project_ref = (
        db.collection("apps")
        .document("shared")
        .collection("projects")
        .document(project_id)
    )
    batch.set(
        project_ref,
        {
            "job_name": job_name,
            "address": address,
            "status": "open",
            "blueprint_gcs_path": None,
            "bt_job_id": project_id,
            "flags": {},
            "schema_version": "v2",
            "project_source": project_source,
            "airtable_record_id": airtable_record_id,
            "v2_job_id": project_id,
            "created_at": now,
        },
    )

    # apps/vendy/v2_jobs/{project_id}
    v2_job_ref = (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
    )
    batch.set(
        v2_job_ref,
        {
            "project_id": project_id,
            "job_name": job_name,
            "address": address,
            "project_source": project_source,
            "airtable_record_id": airtable_record_id,
            "reference_home_ids": reference_home_ids or [],
            "estimate_pdf_gcs_path": estimate_pdf_gcs_path,
            "estimate_synced_at": now if project_source == "airtable" else None,
            "status": "pending",
            "locked": False,
            "locked_at": None,
            "locked_by": None,
            "dxf_present": dxf_present,
            "dxf_gcs_path": dxf_gcs_path,
            "preprocess_status": None,
            "validation_status": None,
            "validation_report": None,
            "estimate_sf": estimate_sf,
            "created_by": created_by,
            "created_at": now,
            "updated_at": now,
        },
    )

    # apps/vendy/v2_jobs/{project_id}/cost_codes/{cost_code}
    for doc in cost_code_docs:
        cc_ref = v2_job_ref.collection("cost_codes").document(doc["cost_code"])
        batch.set(cc_ref, {**doc, "updated_at": now})

    batch.commit()


def update_estimate_sf(project_id: str, estimate_sf: float) -> None:
    """Update the estimate_sf field on the v2_jobs document."""
    db = get_db()
    now = datetime.now(timezone.utc)
    (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
        .update({"estimate_sf": estimate_sf, "updated_at": now})
    )


# ── Phase 9 helpers ───────────────────────────────────────────────────────────


def get_v2_project(project_id: str) -> dict | None:
    """Return the apps/vendy/v2_jobs/{project_id} document as a dict, or None."""
    db = get_db()
    doc = (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
        .get()
    )
    return doc.to_dict() if doc.exists else None


def save_preprocess_result(
    project_id: str,
    shared_params: dict,
    status: str,
) -> None:
    """
    Atomically write SharedParams to dxf_sections/shared_params and
    update preprocess_status on the parent v2_jobs document.
    """
    db = get_db()
    now = datetime.now(timezone.utc)
    batch = db.batch()

    v2_job_ref = (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
    )
    batch.update(v2_job_ref, {"preprocess_status": status, "updated_at": now})

    shared_params_ref = v2_job_ref.collection("dxf_sections").document("shared_params")
    batch.set(shared_params_ref, {**shared_params, "updated_at": now})

    batch.commit()


def log_run(run_doc: dict) -> str:
    """Write a run document to apps/vendy/runs/{run_id}. Returns the run_id."""
    db = get_db()
    run_id = str(uuid.uuid4())
    doc_ref = (
        db.collection("apps").document("vendy").collection("runs").document(run_id)
    )
    doc_ref.set({"run_id": run_id, **run_doc})
    return run_id


# ── Phase 10 helpers ──────────────────────────────────────────────────────────


def get_shared_params(project_id: str) -> dict | None:
    """
    Return the dxf_sections/shared_params subdocument for a v2 project, or None.
    Written by the preprocess endpoint; used by the run endpoint.
    """
    db = get_db()
    doc = (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
        .collection("dxf_sections")
        .document("shared_params")
        .get()
    )
    return doc.to_dict() if doc.exists else None


def update_shared_params(project_id: str, updates: dict) -> dict:
    """
    Merge-update the dxf_sections/shared_params document with the given fields.
    Returns the full updated document dict.
    """
    db = get_db()
    ref = (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
        .collection("dxf_sections")
        .document("shared_params")
    )
    ref.set(updates, merge=True)
    return ref.get().to_dict() or {}


def get_vendor_price_books(cost_code: str | None = None) -> dict[str, dict]:
    """
    Return {vendor_id: price_book_dict} for all vendors in apps/vendy/vendors.

    If cost_code is provided only vendors whose price_book contains that cost code
    under categories are returned — this avoids passing oversized price books to
    agents that only need one cost code's worth of data.

    Each price_book_dict has structure:
        {categories: {cost_code: {item_description: {awarded: {extension: {avg, sample_count}}}}}}
    """
    db = get_db()
    vendors = db.collection("apps").document("vendy").collection("vendors").stream()
    result: dict[str, dict] = {}
    for doc in vendors:
        data = doc.to_dict() or {}
        price_book = data.get("price_book", {})
        if not price_book:
            continue
        if cost_code is None or cost_code in price_book.get("categories", {}):
            result[doc.id] = price_book
    return result


def get_cost_code_doc(project_id: str, cost_code: str) -> dict | None:
    """Return the cost_codes/{cost_code} subdocument for a v2 project, or None."""
    db = get_db()
    doc = (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
        .collection("cost_codes")
        .document(cost_code)
        .get()
    )
    return doc.to_dict() if doc.exists else None


def save_agent_output(
    project_id: str,
    cost_code: str,
    agent_output: dict,
    run_id: str,
    agent_status: str,
) -> None:
    """
    Atomically update the cost_codes/{cost_code} subdocument with agent run results.

    agent_output: AgentOutput.model_dump() from the agent run.
    agent_status: "complete" | "failed" | "manual_required" | "skipped"
    """
    db = get_db()
    now = datetime.now(timezone.utc)
    batch = db.batch()

    cc_ref = (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
        .collection("cost_codes")
        .document(cost_code)
    )
    batch.update(
        cc_ref,
        {
            "agent_status": agent_status,
            "agent_run_id": run_id,
            "quantity": agent_output.get("quantity"),
            "unit": agent_output.get("unit"),
            "output": agent_output.get("output"),
            "confidence": agent_output.get("confidence"),
            "source": agent_output.get("source"),
            "notes": agent_output.get("notes"),
            "flags": agent_output.get("flags", []),
            "agent_type": agent_output.get("agent_type"),
            "updated_at": now,
        },
    )

    batch.commit()


# ── Phase 13 helpers ──────────────────────────────────────────────────────────


def get_all_cost_code_docs(project_id: str) -> list[dict]:
    """Return all cost_codes sub-documents for a v2 project as a list of dicts."""
    db = get_db()
    docs = (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
        .collection("cost_codes")
        .stream()
    )
    return [d.to_dict() for d in docs if d.to_dict()]


def update_v2_project_status(project_id: str, status: str) -> None:
    """Update the status and updated_at fields on a v2_jobs document."""
    db = get_db()
    now = datetime.now(timezone.utc)
    (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
        .update({"status": status, "updated_at": now})
    )


def save_validation_report(
    project_id: str,
    report: dict,
    validation_status: str,
) -> None:
    """Write validation_report + validation_status to the v2_jobs document."""
    db = get_db()
    now = datetime.now(timezone.utc)
    (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
        .update(
            {
                "validation_status": validation_status,
                "validation_report": report,
                "updated_at": now,
            }
        )
    )


def save_takeoff_snapshot(project_id: str, snapshot: dict) -> None:
    """Write a takeoff snapshot to apps/shared/takeoffs/{project_id}."""
    db = get_db()
    now = datetime.now(timezone.utc)
    (
        db.collection("apps")
        .document("shared")
        .collection("takeoffs")
        .document(project_id)
        .set({**snapshot, "saved_at": now})
    )


def lock_v2_project(project_id: str, locked_by: str) -> None:
    """Lock a v2 project — sets locked=True, status=locked, locked_at, locked_by."""
    db = get_db()
    now = datetime.now(timezone.utc)
    (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
        .update(
            {
                "locked": True,
                "locked_at": now,
                "locked_by": locked_by,
                "status": "locked",
                "updated_at": now,
            }
        )
    )


# ── Phase 14 helpers ──────────────────────────────────────────────────────────


def list_v2_projects() -> list[dict]:
    """Return all v2_jobs documents ordered by job_name."""
    db = get_db()
    docs = (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .order_by("job_name")
        .stream()
    )
    return [d.to_dict() for d in docs if d.to_dict()]


def update_cost_code_override(
    project_id: str,
    cost_code: str,
    updates: dict,
    override_by: str,
) -> None:
    """
    Apply PM overrides to a cost_codes sub-document.

    updates may contain: quantity, unit, estimate_final_cost, overrides, override_notes.
    Always sets override_by and updated_at.
    """
    db = get_db()
    now = datetime.now(timezone.utc)
    ref = (
        db.collection("apps")
        .document("vendy")
        .collection("v2_jobs")
        .document(project_id)
        .collection("cost_codes")
        .document(cost_code)
    )
    ref.update({**updates, "override_by": override_by, "updated_at": now})


def get_cost_code_runs(project_id: str, cost_code: str, limit: int = 20) -> list[dict]:
    """
    Return recent agent runs for a specific cost code, newest first.

    Queries apps/vendy/runs filtered by project_id and cost_code.
    """
    db = get_db()
    docs = (
        db.collection("apps")
        .document("vendy")
        .collection("runs")
        .where("project_id", "==", project_id)
        .where("cost_code", "==", cost_code)
        .order_by("started_at", direction="DESCENDING")
        .limit(limit)
        .stream()
    )
    return [d.to_dict() for d in docs if d.to_dict()]
