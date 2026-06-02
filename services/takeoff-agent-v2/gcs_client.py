import os
import tempfile
import time

from google.cloud import storage

from schemas import GCSProject

_client: storage.Client | None = None

BUCKET_NAME = os.environ.get("GCS_BUCKET", "oakley-documents")
GCS_PROJECT = os.environ.get("GCS_PROJECT", "buildertrend-pipeline")

_folders_cache: list[GCSProject] | None = None
_folders_cache_ts: float = 0
FOLDERS_CACHE_TTL = 60  # seconds


def get_client() -> storage.Client:
    global _client
    if _client is None:
        _client = storage.Client(project=GCS_PROJECT)
    return _client


def list_project_folders() -> list[GCSProject]:
    """Return cached list of GCS project folders with file type flags."""
    global _folders_cache, _folders_cache_ts
    now = time.monotonic()
    if _folders_cache is not None and (now - _folders_cache_ts) < FOLDERS_CACHE_TTL:
        return _folders_cache
    result = _scan_project_folders()
    _folders_cache = result
    _folders_cache_ts = now
    return result


def _scan_project_folders() -> list[GCSProject]:
    client = get_client()
    top_blobs = client.list_blobs(BUCKET_NAME, prefix="projects/", delimiter="/")
    list(top_blobs)  # exhaust to populate .prefixes
    folder_names = [p.rstrip("/").split("/", 1)[1] for p in (top_blobs.prefixes or [])]

    folder_info: dict[str, dict] = {
        f: {
            "has_dxf": False,
            "has_pdf": False,
            "has_estimate_pdf": False,
            "last_modified": None,
        }
        for f in folder_names
    }

    for blob in client.list_blobs(BUCKET_NAME, prefix="projects/"):
        parts = blob.name.split("/")
        if len(parts) < 3:
            continue
        folder = parts[1]
        if folder not in folder_info:
            continue
        name_lower = blob.name.lower()
        if name_lower.endswith(".dxf"):
            folder_info[folder]["has_dxf"] = True
        if name_lower.endswith(".pdf"):
            folder_info[folder]["has_pdf"] = True
        if "/estimate/" in blob.name and name_lower.endswith(".pdf"):
            folder_info[folder]["has_estimate_pdf"] = True
        last_mod = blob.updated
        if last_mod:
            ts = (
                last_mod.isoformat()
                if hasattr(last_mod, "isoformat")
                else str(last_mod)
            )
            existing = folder_info[folder]["last_modified"]
            if existing is None or ts > existing:
                folder_info[folder]["last_modified"] = ts

    return [
        GCSProject(
            folder_name=name,
            has_dxf=info["has_dxf"],
            has_pdf=info["has_pdf"],
            has_estimate_pdf=info["has_estimate_pdf"],
            last_modified=info["last_modified"],
        )
        for name, info in folder_info.items()
    ]


def check_dxf_present(job_name: str, file_hint: str | None = None) -> dict:
    """Check if a DXF file exists under projects/{job_name}/blueprints/.

    file_hint — optional keyword to prefer a specific DXF sheet, e.g. "roof",
    "fdn", "elev", "pl1".  Files whose names contain the hint (case-insensitive)
    are chosen first.  When no hint is given the function prefers first-floor
    plan sheets ("pl1") over others, so count agents get the richest file by
    default instead of whatever comes first alphabetically.
    """
    client = get_client()
    prefix = f"projects/{job_name}/blueprints/"
    all_dxf = sorted(
        b.name
        for b in client.list_blobs(BUCKET_NAME, prefix=prefix)
        if b.name.lower().endswith(".dxf")
    )
    if not all_dxf:
        return {"dxf_present": False, "dxf_gcs_path": None}

    # 1. Explicit hint takes priority
    if file_hint:
        matches = [p for p in all_dxf if file_hint.lower() in p.lower()]
        if matches:
            return {"dxf_present": True, "dxf_gcs_path": matches[0]}

    # 2. Default preference: pl1 (most entities) > pl2 > any
    for pref in ("pl1", "plan1", "p1", "pl2", "plan2"):
        matches = [p for p in all_dxf if pref in p.lower()]
        if matches:
            return {"dxf_present": True, "dxf_gcs_path": matches[0]}

    # 3. First alphabetically
    return {"dxf_present": True, "dxf_gcs_path": all_dxf[0]}


def download_dxf_to_temp(gcs_path: str) -> str:
    """Download a DXF file from GCS to a local temp file; caller is responsible for cleanup."""
    client = get_client()
    bucket = client.bucket(BUCKET_NAME)
    blob = bucket.blob(gcs_path)
    with tempfile.NamedTemporaryFile(delete=False, suffix=".dxf") as tmp:
        blob.download_to_file(tmp)
        return tmp.name


def upload_estimate_pdf(job_name: str, file_bytes: bytes) -> str:
    """Upload a PDF estimate to projects/{job_name}/estimate/estimate.pdf."""
    client = get_client()
    bucket = client.bucket(BUCKET_NAME)
    gcs_path = f"projects/{job_name}/estimate/estimate.pdf"
    blob = bucket.blob(gcs_path)
    blob.upload_from_string(file_bytes, content_type="application/pdf")
    return gcs_path
