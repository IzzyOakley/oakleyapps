import os
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
