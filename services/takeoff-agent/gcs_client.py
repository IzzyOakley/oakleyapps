import io
import os
import time
import datetime
from google.cloud import storage
import fitz  # PyMuPDF — no system poppler dependency

_client: storage.Client | None = None

# ── In-memory scan cache ─────────────────────────────────────────────────────
_scan_cache: dict | None = None
_scan_cache_ts: float = 0
SCAN_CACHE_TTL = 60  # seconds

BUCKET_NAME = os.environ.get("GCS_BUCKET", "oakley-documents")
GCS_PROJECT = os.environ.get("GCS_PROJECT", "buildertrend-pipeline")


def get_client() -> storage.Client:
    global _client
    if _client is None:
        _client = storage.Client(project=GCS_PROJECT)
    return _client


def scan_all_projects_cached() -> dict[str, str | None]:
    """Return cached result of scan_all_projects() if less than 60s old."""
    global _scan_cache, _scan_cache_ts
    now = time.monotonic()
    if _scan_cache is not None and (now - _scan_cache_ts) < SCAN_CACHE_TTL:
        return _scan_cache
    result = scan_all_projects()
    _scan_cache = result
    _scan_cache_ts = now
    return result


def scan_all_projects() -> dict[str, str | None]:
    """
    Single-pass GCS scan.  Returns {folder_name: first_pdf_path_or_None}
    for every project folder under projects/ in the bucket.
    """
    client = get_client()
    # Collect folder prefixes
    top_blobs = client.list_blobs(BUCKET_NAME, prefix="projects/", delimiter="/")
    list(top_blobs)  # exhaust to populate .prefixes
    folder_names = [
        p.rstrip("/").split("/", 1)[1]
        for p in top_blobs.prefixes
    ]

    # One more scan for all PDFs anywhere under projects/ (blueprints/ subfolder or root)
    pdf_by_folder: dict[str, str] = {}
    for blob in client.list_blobs(BUCKET_NAME, prefix="projects/"):
        if not blob.name.lower().endswith(".pdf"):
            continue
        parts = blob.name.split("/")
        # parts[0]="projects", parts[1]=folder_name, parts[2+]=path within folder
        if len(parts) < 3:
            continue
        folder = parts[1]
        if folder not in pdf_by_folder:
            pdf_by_folder[folder] = blob.name

    return {f: pdf_by_folder.get(f) for f in folder_names}


def resolve_blueprint_path(job_name: str, stored_path: str | None) -> str | None:
    """Try stored path first. If not found, scan projects/{job_name}/blueprints/"""
    client = get_client()
    bucket = client.bucket(BUCKET_NAME)

    if stored_path:
        blob = bucket.blob(stored_path)
        if blob.exists():
            return stored_path

    # Fallback: scan entire project folder for any PDF (blueprints/ subdir or root)
    prefix = f"projects/{job_name}/"
    blobs = list(client.list_blobs(BUCKET_NAME, prefix=prefix))
    pdf_blobs = sorted(
        [b for b in blobs if b.name.lower().endswith(".pdf")],
        # Prefer files inside a blueprints/ subfolder
        key=lambda b: (0 if "/blueprints/" in b.name else 1, b.name),
    )
    if pdf_blobs:
        return pdf_blobs[0].name

    return None


def download_blueprint(gcs_path: str) -> bytes:
    """Download PDF bytes from gs://oakley-documents/{gcs_path}"""
    client = get_client()
    bucket = client.bucket(BUCKET_NAME)
    blob = bucket.blob(gcs_path)
    return blob.download_as_bytes()


def upload_blueprint(job_name: str, filename: str, data: bytes) -> str:
    """Upload PDF and return the GCS path (without gs:// prefix)."""
    client = get_client()
    bucket = client.bucket(BUCKET_NAME)
    gcs_path = f"projects/{job_name}/blueprints/{filename}"
    blob = bucket.blob(gcs_path)
    blob.upload_from_string(data, content_type="application/pdf")
    return gcs_path


def get_blueprint_page_images(gcs_path: str, job_name: str) -> list[dict]:
    """
    Return signed URLs (1-hour expiry) for each blueprint page PNG.

    If the pages have already been rendered and uploaded to GCS (cached),
    skip the PDF render entirely and return signed URLs for the existing blobs.
    Otherwise render the PDF, upload the PNGs, then return signed URLs.
    """
    client = get_client()
    bucket = client.bucket(BUCKET_NAME)
    expiry = datetime.timedelta(hours=1)
    pages_prefix = f"projects/{job_name}/blueprint-pages/"
    sentinel = f"{pages_prefix}page_001.png"

    # ── Cache hit: pages already exist in GCS ────────────────────────────────
    sentinel_blob = bucket.blob(sentinel)
    if sentinel_blob.exists():
        existing = sorted(
            [b for b in client.list_blobs(BUCKET_NAME, prefix=pages_prefix)
             if b.name.lower().endswith(".png")],
            key=lambda b: b.name,
        )
        pages = []
        for blob in existing:
            url = blob.generate_signed_url(
                expiration=expiry,
                method="GET",
                version="v4",
            )
            # Extract page number from filename (page_001.png → 1)
            try:
                page_num = int(blob.name.rsplit("page_", 1)[1].split(".")[0])
            except (IndexError, ValueError):
                page_num = len(pages) + 1
            pages.append({
                "page_number": page_num,
                "url": url,
                # Width/height not available without downloading; omit for cache hits
                "width": None,
                "height": None,
            })
        return pages

    # ── Cache miss: render PDF and upload PNGs ────────────────────────────────
    pdf_bytes = download_blueprint(gcs_path)

    # Use PyMuPDF — no poppler/system dependency needed
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pages = []

    for i in range(len(doc)):
        page_num = i + 1
        page = doc[i]

        # Render at 150 DPI (matrix scale = 150/72 ≈ 2.08)
        mat = fitz.Matrix(150 / 72, 150 / 72)
        pix = page.get_pixmap(matrix=mat, alpha=False)
        png_bytes = pix.tobytes("png")

        png_path = f"{pages_prefix}page_{page_num:03d}.png"

        # Upload page image
        blob = bucket.blob(png_path)
        blob.upload_from_string(png_bytes, content_type="image/png")

        # Generate signed URL (1 hr)
        url = blob.generate_signed_url(
            expiration=expiry,
            method="GET",
            version="v4",
        )

        pages.append({
            "page_number": page_num,
            "url": url,
            "width": pix.width,
            "height": pix.height,
        })

    doc.close()
    return pages
