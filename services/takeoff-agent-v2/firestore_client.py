import os
import re
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
