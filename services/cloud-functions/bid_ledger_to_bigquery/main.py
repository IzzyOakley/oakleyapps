"""
Cloud Function: bid_ledger_to_bigquery
GCP Project: buildertrend-pipeline
Trigger: Cloud Scheduler (nightly, e.g. 02:00 UTC)

Exports bid_ledger subcollection documents to BigQuery.
Subcollections are NOT exported by the Firestore→BigQuery extension, so this
function handles them explicitly.

Incremental: only processes documents with created_at > last_run_timestamp.
State is stored in apps/vendy/analytics_config/bid_ledger_export.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from typing import Any

import functions_framework
from google.cloud import bigquery, firestore

logger = logging.getLogger(__name__)

FIREBASE_PROJECT = os.environ.get("FIREBASE_PROJECT_ID", "buildertrend-pipeline")
BQ_PROJECT = os.environ.get("BQ_PROJECT_ID", "buildertrend-pipeline")
BQ_DATASET = os.environ.get("BQ_DATASET", "vendy_analytics")
BQ_TABLE = os.environ.get("BQ_TABLE", "bid_ledger")

_db: firestore.Client | None = None
_bq: bigquery.Client | None = None

CONFIG_PATH = ("apps", "vendy", "analytics_config", "bid_ledger_export")


def get_db() -> firestore.Client:
    global _db
    if _db is None:
        _db = firestore.Client(project=FIREBASE_PROJECT)
    return _db


def get_bq() -> bigquery.Client:
    global _bq
    if _bq is None:
        _bq = bigquery.Client(project=BQ_PROJECT)
    return _bq


def _get_config() -> dict:
    db = get_db()
    ref = (
        db.collection(CONFIG_PATH[0])
        .document(CONFIG_PATH[1])
        .collection(CONFIG_PATH[2])
        .document(CONFIG_PATH[3])
    )
    snap = ref.get()
    return snap.to_dict() or {} if snap.exists else {}


def _save_config(data: dict) -> None:
    db = get_db()
    ref = (
        db.collection(CONFIG_PATH[0])
        .document(CONFIG_PATH[1])
        .collection(CONFIG_PATH[2])
        .document(CONFIG_PATH[3])
    )
    ref.set(data, merge=True)


def _ensure_table() -> str:
    """Create the bid_ledger BigQuery table if it doesn't exist. Returns full table ID."""
    bq = get_bq()
    table_id = f"{BQ_PROJECT}.{BQ_DATASET}.{BQ_TABLE}"
    schema = [
        bigquery.SchemaField("vendor_id", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("bid_id", "STRING", mode="REQUIRED"),
        bigquery.SchemaField("project_id", "STRING"),
        bigquery.SchemaField("project_name", "STRING"),
        bigquery.SchemaField("cost_code", "STRING"),
        bigquery.SchemaField("cost_code_name", "STRING"),
        bigquery.SchemaField("outcome", "STRING"),
        bigquery.SchemaField("bid_date", "DATE"),
        bigquery.SchemaField("subtotal", "FLOAT64"),
        bigquery.SchemaField("created_at", "TIMESTAMP"),
        bigquery.SchemaField("line_items_json", "STRING"),  # JSON array string
    ]
    try:
        bq.get_table(table_id)
    except Exception:
        table = bigquery.Table(table_id, schema=schema)
        table.time_partitioning = bigquery.TimePartitioning(
            type_=bigquery.TimePartitioningType.DAY, field="created_at"
        )
        bq.create_table(table, exists_ok=True)
        logger.info("Created BigQuery table %s", table_id)
    return table_id


@functions_framework.http
def bid_ledger_to_bigquery(request):
    """
    HTTP-triggered Cloud Function (invoked by Cloud Scheduler).
    Exports bid_ledger subcollection documents added since last run.
    """
    logger.info("bid_ledger_to_bigquery started")

    config = _get_config()
    last_run: datetime | None = None
    if config.get("last_run_timestamp"):
        ts = config["last_run_timestamp"]
        last_run = ts if isinstance(ts, datetime) else datetime.fromisoformat(str(ts))
        if last_run.tzinfo is None:
            last_run = last_run.replace(tzinfo=timezone.utc)

    db = get_db()

    # Collection group query across all vendors' bid_ledger subcollections
    query = db.collection_group("bid_ledger")
    if last_run:
        query = query.where(filter=firestore.FieldFilter("created_at", ">", last_run))
    query = query.order_by("created_at")

    docs = list(query.stream())
    logger.info("Found %d new bid_ledger documents since %s", len(docs), last_run)

    if not docs:
        _save_config(
            {"last_run_timestamp": datetime.now(timezone.utc), "last_run_count": 0}
        )
        return {"status": "ok", "rows_inserted": 0}

    # Build BigQuery rows
    rows: list[dict[str, Any]] = []
    for doc in docs:
        data = doc.to_dict() or {}
        # Extract vendor_id from the document path:
        # apps/vendy/vendors/{vendor_id}/bid_ledger/{bid_id}
        path_parts = doc.reference.path.split("/")
        # path: apps/vendy/vendors/{vendor_id}/bid_ledger/{bid_id}
        vendor_id = path_parts[4] if len(path_parts) >= 5 else data.get("vendor_id", "")

        created_at = data.get("created_at")
        if isinstance(created_at, datetime):
            created_at_str = created_at.isoformat()
        else:
            created_at_str = str(created_at) if created_at else None

        bid_date = data.get("bid_date")
        bid_date_str = str(bid_date) if bid_date else None

        line_items = data.get("line_items", [])

        rows.append(
            {
                "vendor_id": vendor_id,
                "bid_id": data.get("bid_id", doc.id),
                "project_id": data.get("project_id", ""),
                "project_name": data.get("project_name", ""),
                "cost_code": data.get("cost_code", ""),
                "cost_code_name": data.get("cost_code_name", ""),
                "outcome": data.get("outcome", ""),
                "bid_date": bid_date_str,
                "subtotal": data.get("subtotal"),
                "created_at": created_at_str,
                "line_items_json": json.dumps(line_items),
            }
        )

    table_id = _ensure_table()
    bq = get_bq()
    errors = bq.insert_rows_json(table_id, rows)
    if errors:
        logger.error("BigQuery insert errors: %s", errors)
        return {"status": "error", "errors": str(errors)}, 500

    now = datetime.now(timezone.utc)
    _save_config({"last_run_timestamp": now, "last_run_count": len(rows)})
    logger.info("Inserted %d rows into %s", len(rows), table_id)
    return {"status": "ok", "rows_inserted": len(rows)}
