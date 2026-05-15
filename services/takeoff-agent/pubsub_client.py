import json
import os
from google.cloud import pubsub_v1
from google.api_core.exceptions import AlreadyExists

PUBSUB_PROJECT = os.environ.get("PUBSUB_PROJECT", "buildertrend-pipeline")
PUBSUB_TOPIC = os.environ.get("PUBSUB_TOPIC", "takeoff-events")

_publisher: pubsub_v1.PublisherClient | None = None


def get_publisher() -> pubsub_v1.PublisherClient:
    global _publisher
    if _publisher is None:
        _publisher = pubsub_v1.PublisherClient()
    return _publisher


def ensure_topic_exists() -> str:
    publisher = get_publisher()
    topic_path = publisher.topic_path(PUBSUB_PROJECT, PUBSUB_TOPIC)
    try:
        publisher.create_topic(request={"name": topic_path})
    except AlreadyExists:
        pass
    return topic_path


def publish_takeoff_approved(
    project_id: str,
    job_id: str,
    project_name: str,
    address: str,
    approved_by: str,
    approved_at: str,
    summary: dict,
) -> None:
    publisher = get_publisher()
    topic_path = ensure_topic_exists()

    message = {
        "event": "takeoff.approved",
        "project_id": project_id,
        "job_id": job_id,
        "project_name": project_name,
        "address": address,
        "approved_by": approved_by,
        "approved_at": approved_at,
        "summary": summary,
    }

    data = json.dumps(message).encode("utf-8")
    future = publisher.publish(topic_path, data=data)
    future.result()  # Wait for confirmation
