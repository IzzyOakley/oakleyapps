import os
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


# ── Projects ────────────────────────────────────────────────────────────────


def list_projects() -> list[dict]:
    db = get_db()
    docs = db.collection("apps").document("shared").collection("projects").stream()
    return [{"project_id": d.id, **d.to_dict()} for d in docs]


def get_project(project_id: str) -> dict | None:
    db = get_db()
    doc = (
        db.collection("apps")
        .document("shared")
        .collection("projects")
        .document(project_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"project_id": doc.id, **doc.to_dict()}


def create_project(job_name: str, address: str) -> str:
    import re

    db = get_db()
    # Consistent slug: collapse any non-alphanumeric run into a single underscore
    # Matches the slug used when auto-discovering projects from GCS folder names
    project_id = re.sub(r"[^a-z0-9]+", "_", job_name.lower()).strip("_")
    # Ensure uniqueness
    ref = (
        db.collection("apps")
        .document("shared")
        .collection("projects")
        .document(project_id)
    )
    ref.set(
        {
            "job_name": job_name,
            "address": address,
            "status": "open",
            "blueprint_gcs_path": None,
            "bt_job_id": project_id,
            "flags": {},
            "created_at": datetime.now(timezone.utc),
        }
    )
    return project_id


def update_project_blueprint(project_id: str, gcs_path: str) -> None:
    db = get_db()
    db.collection("apps").document("shared").collection("projects").document(
        project_id
    ).update(
        {
            "blueprint_gcs_path": gcs_path,
        }
    )


# ── Takeoff Jobs ────────────────────────────────────────────────────────────


def list_jobs_by_projects(project_ids: list[str]) -> dict[str, dict]:
    """Return {project_id: latest_job} for a list of project IDs in a single batch.
    Uses Firestore 'in' query (max 30 items per query, chunked if needed)."""
    if not project_ids:
        return {}

    db = get_db()
    project_refs = [f"apps/shared/projects/{pid}" for pid in project_ids]

    # Chunk into groups of 30 (Firestore 'in' query limit)
    chunk_size = 30
    all_jobs: list[dict] = []
    for start in range(0, len(project_refs), chunk_size):
        chunk = project_refs[start : start + chunk_size]
        docs = (
            db.collection("apps")
            .document("vendy")
            .collection("jobs")
            .where(filter=firestore.FieldFilter("project_ref", "in", chunk))
            .stream()
        )
        for d in docs:
            all_jobs.append({"job_id": d.id, **d.to_dict()})

    # Group by project_id, keep only the latest job per project
    by_project: dict[str, list[dict]] = {}
    for job in all_jobs:
        ref: str = job.get("project_ref", "")
        pid = ref.split("/")[-1]
        by_project.setdefault(pid, []).append(job)

    result: dict[str, dict] = {}
    for pid, jobs in by_project.items():
        jobs.sort(
            key=lambda j: (
                j.get("created_at") or datetime.min.replace(tzinfo=timezone.utc)
            ),
            reverse=True,
        )
        result[pid] = jobs[0]

    return result


def get_latest_job_for_project(project_id: str) -> dict | None:
    db = get_db()
    project_ref_path = f"apps/shared/projects/{project_id}"
    # Avoid a composite index requirement by sorting in Python.
    # Each project has at most a handful of jobs so this is fine.
    docs = (
        db.collection("apps")
        .document("vendy")
        .collection("jobs")
        .where(filter=firestore.FieldFilter("project_ref", "==", project_ref_path))
        .stream()
    )
    jobs = [{"job_id": d.id, **d.to_dict()} for d in docs]
    if not jobs:
        return None
    jobs.sort(
        key=lambda j: j.get("created_at") or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )
    return jobs[0]


def create_job(project_id: str, created_by: str) -> str:
    db = get_db()
    job_id = str(uuid.uuid4())
    db.collection("apps").document("vendy").collection("jobs").document(job_id).set(
        {
            "project_ref": f"apps/shared/projects/{project_id}",
            "status": "pending",
            "blueprints": [],
            "takeoff_data": None,
            "created_by": created_by,
            "created_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
            "flags": [],
        }
    )
    return job_id


def get_job(job_id: str) -> dict | None:
    db = get_db()
    doc = (
        db.collection("apps")
        .document("vendy")
        .collection("jobs")
        .document(job_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"job_id": doc.id, **doc.to_dict()}


def update_job_status(job_id: str, status: str, error: str | None = None) -> None:
    db = get_db()
    update: dict = {"status": status, "updated_at": datetime.now(timezone.utc)}
    if error:
        update["error"] = error
    db.collection("apps").document("vendy").collection("jobs").document(job_id).update(
        update
    )


def write_takeoff_data(job_id: str, takeoff_data: dict) -> None:
    db = get_db()
    db.collection("apps").document("vendy").collection("jobs").document(job_id).update(
        {
            "takeoff_data": takeoff_data,
            "status": "complete",
            "updated_at": datetime.now(timezone.utc),
        }
    )


def update_item_in_job(
    job_id: str, item_id: str, pm_override: float | None, notes: str | None, status: str
) -> bool:
    """Update a single item inside takeoff_data.sections[*].items[*]."""
    db = get_db()
    ref = db.collection("apps").document("vendy").collection("jobs").document(job_id)
    doc = ref.get()
    if not doc.exists:
        return False

    data = doc.to_dict()
    takeoff_data = data.get("takeoff_data") or {}
    sections = takeoff_data.get("sections", [])
    found = False

    for section in sections:
        for item in section.get("items", []):
            if item.get("item_id") == item_id:
                item["status"] = status
                item["flagged"] = False
                if pm_override is not None:
                    item["pm_override"] = pm_override
                    item["quantity"] = pm_override
                if notes is not None:
                    item["notes"] = notes
                found = True
                break
        if found:
            break

    if not found:
        return False

    # Recalculate flagged_items count
    total_flagged = sum(
        1 for s in sections for i in s.get("items", []) if i.get("flagged", False)
    )
    if "summary" in takeoff_data:
        takeoff_data["summary"]["flagged_items"] = total_flagged

    ref.update(
        {
            "takeoff_data": takeoff_data,
            "updated_at": datetime.now(timezone.utc),
        }
    )
    return True


# ── Approved Takeoffs ───────────────────────────────────────────────────────


def write_approved_takeoff(
    project_id: str, job_id: str, project: dict, takeoff_data: dict, approved_by: str
) -> None:
    db = get_db()
    db.collection("apps").document("shared").collection("takeoffs").document(
        project_id
    ).set(
        {
            "project_id": project_id,
            "project_name": project.get("job_name", ""),
            "address": project.get("address", ""),
            "approved_by": approved_by,
            "approved_at": datetime.now(timezone.utc),
            "job_ref": f"apps/vendy/jobs/{job_id}",
            "summary": takeoff_data.get("summary", {}),
            "sections": takeoff_data.get("sections", []),
            "version": 1,
        }
    )
