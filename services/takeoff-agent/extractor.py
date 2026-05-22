import base64
import json
import os
import uuid
from pathlib import Path

import anthropic

from firestore_client import update_job_status, write_takeoff_data
from gcs_client import resolve_blueprint_path, download_blueprint

MODEL_VERSION = os.environ.get("MODEL_VERSION", "claude-opus-4-5")
PROMPT_VERSION = os.environ.get("PROMPT_VERSION", "v1")

_anthropic_client: anthropic.Anthropic | None = None


def _get_anthropic_api_key() -> str:
    """
    Fetch the Anthropic API key from GCP Secret Manager.
    Falls back to ANTHROPIC_API_KEY env var if set (useful for local dev
    when you don't want to hit Secret Manager).
    """
    # Env var override — useful for local dev only
    env_key = os.environ.get("ANTHROPIC_API_KEY")
    if env_key:
        return env_key

    # Fetch from Secret Manager (production + cloud dev)
    from google.cloud import secretmanager

    project = os.environ.get("GCS_PROJECT", "buildertrend-pipeline")
    secret_name = os.environ.get("ANTHROPIC_SECRET_NAME", "anthropic-api-key")
    client = secretmanager.SecretManagerServiceClient()
    secret_path = f"projects/{project}/secrets/{secret_name}/versions/latest"
    response = client.access_secret_version(request={"name": secret_path})
    return response.payload.data.decode("utf-8").strip()


def get_anthropic_client() -> anthropic.Anthropic:
    global _anthropic_client
    if _anthropic_client is None:
        _anthropic_client = anthropic.Anthropic(api_key=_get_anthropic_api_key())
    return _anthropic_client


def load_system_prompt(version: str = "v1") -> str:
    prompt_path = Path(__file__).parent / "prompts" / f"takeoff_{version}.md"
    return prompt_path.read_text(encoding="utf-8")


def assign_item_ids(data: dict) -> dict:
    """Add uuid item_id and initial status to each extracted item."""
    for section in data.get("sections", []):
        for item in section.get("items", []):
            item["item_id"] = str(uuid.uuid4())
            item["pm_override"] = None
            if item.get("flagged"):
                item["status"] = "flagged"
            else:
                item["status"] = "extracted"
    return data


def compute_summary_counts(data: dict) -> dict:
    """Fill in total_items and flagged_items counts."""
    total = 0
    flagged = 0
    for section in data.get("sections", []):
        for item in section.get("items", []):
            total += 1
            if item.get("flagged"):
                flagged += 1
    if "summary" not in data:
        data["summary"] = {}
    data["summary"]["total_items"] = total
    data["summary"]["flagged_items"] = flagged
    return data


async def run_takeoff(job_id: str, project: dict) -> None:
    """
    Full async extraction pipeline:
    1. Resolve GCS path
    2. Download PDF
    3. Mark job as processing
    4. Call Claude with PDF as document
    5. Parse JSON response
    6. Write results to Firestore
    """
    try:
        job_name = project.get("job_name", "")
        stored_path = project.get("blueprint_gcs_path")

        # 1. Resolve path
        gcs_path = resolve_blueprint_path(job_name, stored_path)
        if not gcs_path:
            raise ValueError(f"No blueprint PDF found for project: {job_name}")

        # Update Firestore with resolved path if different
        if gcs_path != stored_path:
            from firestore_client import update_project_blueprint

            project_id = project.get("project_id", "")
            if project_id:
                update_project_blueprint(project_id, gcs_path)

        # 2. Download PDF
        pdf_bytes = download_blueprint(gcs_path)

        # 3. Mark processing
        update_job_status(job_id, "processing")

        # 4. Call Claude — PDF as base64 document
        client = get_anthropic_client()
        system_prompt = load_system_prompt(PROMPT_VERSION)
        pdf_b64 = base64.standard_b64encode(pdf_bytes).decode("utf-8")

        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": pdf_b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": "Extract the complete quantity takeoff from this blueprint PDF. Return only the JSON object as specified.",
                    },
                ],
            }
        ]

        # Use streaming to avoid the 10-minute non-streaming timeout on large blueprints
        with client.messages.stream(
            model=MODEL_VERSION,
            max_tokens=32000,
            system=system_prompt,
            messages=messages,
        ) as stream:
            response = stream.get_final_message()

        # 5. Parse response
        if response.stop_reason == "max_tokens":
            raise ValueError(
                f"Claude response was truncated (hit max_tokens limit). "
                f"Response was {len(response.content[0].text)} chars. "
                f"Consider splitting large blueprints or increasing max_tokens further."
            )
        raw_text = response.content[0].text.strip()
        # Strip markdown fences if Claude added them despite instructions
        if raw_text.startswith("```"):
            raw_text = raw_text.split("\n", 1)[1]
            raw_text = raw_text.rsplit("```", 1)[0].strip()

        data = json.loads(raw_text)

        # 6. Enrich with IDs and counts
        data = assign_item_ids(data)
        data = compute_summary_counts(data)

        # 7. Write to Firestore
        write_takeoff_data(job_id, data)

    except Exception as exc:
        error_msg = str(exc)
        update_job_status(job_id, "failed", error=error_msg)
        raise
