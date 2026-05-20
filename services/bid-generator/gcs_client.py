import os
from google.cloud import storage

_client: storage.Client | None = None

BUCKET_NAME = os.environ.get("GCS_BUCKET", "oakley-documents")
GCS_PROJECT = os.environ.get("GCS_PROJECT", "buildertrend-pipeline")


def get_client() -> storage.Client:
    global _client
    if _client is None:
        _client = storage.Client(project=GCS_PROJECT)
    return _client


def find_project_notes(job_name: str) -> str | None:
    """Return the GCS path of the first PDF under projects/{job_name}/project-notes/, or None."""
    client = get_client()
    prefix = f"projects/{job_name}/project-notes/"
    blobs = list(client.list_blobs(BUCKET_NAME, prefix=prefix))
    pdf_blobs = [b for b in blobs if b.name.lower().endswith(".pdf")]
    return pdf_blobs[0].name if pdf_blobs else None


def download_bytes(gcs_path: str) -> bytes:
    """Download and return raw bytes from GCS."""
    client = get_client()
    return client.bucket(BUCKET_NAME).blob(gcs_path).download_as_bytes()


def upload_project_notes(job_name: str, filename: str, data: bytes) -> str:
    """Upload a project notes PDF and return the GCS path."""
    client = get_client()
    gcs_path = f"projects/{job_name}/project-notes/{filename}"
    client.bucket(BUCKET_NAME).blob(gcs_path).upload_from_string(
        data, content_type="application/pdf"
    )
    return gcs_path
