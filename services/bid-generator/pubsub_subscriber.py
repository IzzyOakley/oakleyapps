"""
Pub/Sub streaming pull subscriber for the takeoff-events topic.

Runs in a background daemon thread so the FastAPI server stays responsive.
On takeoff.approved events, calls process_approved_takeoff(project_id).

GCP setup (run once in Cloud Shell against buildertrend-pipeline):
  gcloud pubsub subscriptions create takeoff-events-bid-generator \\
    --topic=takeoff-events \\
    --project=buildertrend-pipeline \\
    --ack-deadline=300 \\
    --message-retention-duration=7d

The Cloud Run service account also needs subscriber access:
  gcloud pubsub subscriptions add-iam-policy-binding \\
    takeoff-events-bid-generator \\
    --member="serviceAccount:<SA_EMAIL>" \\
    --role="roles/pubsub.subscriber" \\
    --project=buildertrend-pipeline
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import threading

from google.api_core.exceptions import NotFound
from google.cloud import pubsub_v1

logger = logging.getLogger(__name__)

PUBSUB_PROJECT = os.environ.get("PUBSUB_PROJECT", "buildertrend-pipeline")
PUBSUB_TOPIC = os.environ.get("PUBSUB_TOPIC", "takeoff-events")
SUBSCRIPTION_ID = os.environ.get(
    "PUBSUB_SUBSCRIPTION", f"{PUBSUB_TOPIC}-bid-generator"
)


def _ensure_subscription(
    subscriber: pubsub_v1.SubscriberClient, subscription_path: str
) -> None:
    """Create the subscription if it does not yet exist."""
    try:
        subscriber.get_subscription(request={"subscription": subscription_path})
    except NotFound:
        publisher = pubsub_v1.PublisherClient()
        topic_path = publisher.topic_path(PUBSUB_PROJECT, PUBSUB_TOPIC)
        try:
            subscriber.create_subscription(
                request={
                    "name": subscription_path,
                    "topic": topic_path,
                    "ack_deadline_seconds": 300,
                }
            )
            logger.info("Created Pub/Sub subscription %s", subscription_path)
        except Exception as exc:
            logger.warning(
                "Could not create subscription %s: %s — it may already exist or "
                "the service account lacks pubsub.subscriptions.create permission.",
                subscription_path,
                exc,
            )


def start_subscriber(process_fn) -> threading.Thread:
    """
    Start a streaming pull subscriber in a background daemon thread.

    process_fn must be an async coroutine function accepting (project_id: str).
    Errors in process_fn cause a nack (Pub/Sub will retry).
    Permanently malformed messages are acked without processing.
    """

    def _callback(message: pubsub_v1.subscriber.message.Message) -> None:
        try:
            data = json.loads(message.data.decode("utf-8"))
        except Exception as exc:
            logger.error("Failed to decode Pub/Sub message: %s", exc)
            message.ack()
            return

        event = data.get("event")
        if event != "takeoff.approved":
            logger.debug("Ignoring event type: %s", event)
            message.ack()
            return

        project_id = data.get("project_id", "").strip()
        if not project_id:
            logger.warning("takeoff.approved message missing project_id — acking")
            message.ack()
            return

        logger.info(
            "Received takeoff.approved for project=%s job=%s",
            project_id,
            data.get("job_id", "?"),
        )

        try:
            asyncio.run(process_fn(project_id))
            message.ack()
            logger.info("Bid generation complete for project=%s", project_id)
        except Exception as exc:
            logger.error(
                "process_approved_takeoff failed project=%s: %s — nacking", project_id, exc
            )
            message.nack()

    def _run() -> None:
        subscriber = pubsub_v1.SubscriberClient()
        subscription_path = subscriber.subscription_path(PUBSUB_PROJECT, SUBSCRIPTION_ID)
        _ensure_subscription(subscriber, subscription_path)
        logger.info("Pub/Sub subscriber listening on %s", subscription_path)

        streaming_pull_future = subscriber.subscribe(
            subscription_path,
            callback=_callback,
            flow_control=pubsub_v1.types.FlowControl(max_messages=5),
        )
        try:
            streaming_pull_future.result()
        except Exception as exc:
            logger.error("Pub/Sub streaming pull stopped: %s", exc)
            streaming_pull_future.cancel()
            streaming_pull_future.result()

    thread = threading.Thread(target=_run, daemon=True, name="pubsub-subscriber")
    thread.start()
    return thread
