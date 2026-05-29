"""
Pub/Sub client for takeoff-agent-v2.

Publishes messages to `takeoff-events-v2` when a takeoff snapshot is approved.
Downstream consumers (e.g. bid-generator) subscribe to act on approved takeoffs.
"""

from __future__ import annotations

import json
import os

from google.cloud import pubsub_v1

_publisher: pubsub_v1.PublisherClient | None = None
_TOPIC_ID = "takeoff-events-v2"


def get_publisher() -> pubsub_v1.PublisherClient:
    global _publisher
    if _publisher is None:
        _publisher = pubsub_v1.PublisherClient()
    return _publisher


def publish_takeoff_approved(
    project_id: str,
    extra: dict | None = None,
) -> str:
    """
    Publish a takeoff_approved event to takeoff-events-v2.

    Returns the Pub/Sub message ID.

    Payload schema:
      {
        "event_type": "takeoff_approved",
        "project_id": "<id>",
        "schema_version": "v2",
        ...extra fields (job_name, approved_by, etc.)
      }
    """
    gcp_project = os.environ.get("FIREBASE_PROJECT_ID", "buildertrend-pipeline")
    topic_path = get_publisher().topic_path(gcp_project, _TOPIC_ID)

    payload: dict = {
        "event_type": "takeoff_approved",
        "project_id": project_id,
        "schema_version": "v2",
        **(extra or {}),
    }
    data = json.dumps(payload).encode("utf-8")
    future = get_publisher().publish(topic_path, data)
    return future.result()
