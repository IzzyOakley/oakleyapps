"""
Cloud Function: on_bid_outcome
GCP Project: buildertrend-pipeline
Trigger: Firestore document update on apps/vendy/bids/{bid_id}

Fires only when the status field changes TO "awarded" or "not_awarded".
On trigger:
  1. Writes an append-only entry to apps/vendy/vendors/{vendor_id}/bid_ledger/{bid_id}
  2. Updates price_book rolling stats (min/max/avg/sample_count) for each line item
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, date, timezone
from typing import Any

import functions_framework
from google.cloud import firestore
from google.events.cloud.firestore import DocumentEventData

logger = logging.getLogger(__name__)

FIREBASE_PROJECT = os.environ.get("FIREBASE_PROJECT_ID", "buildertrend-pipeline")
OUTCOME_STATUSES = frozenset({"awarded", "not_awarded"})

_db: firestore.Client | None = None


def get_db() -> firestore.Client:
    global _db
    if _db is None:
        _db = firestore.Client(project=FIREBASE_PROJECT)
    return _db


# ── Entry point ────────────────────────────────────────────────────────────────


@functions_framework.cloud_event
def on_bid_outcome(cloud_event):
    """
    Triggered by Firestore onUpdate on apps/vendy/bids/{bid_id}.
    Only acts when status changes to 'awarded' or 'not_awarded'.
    """
    try:
        payload = DocumentEventData()
        payload._pb.MergeFromString(cloud_event.data)
    except Exception as exc:
        logger.error("Failed to parse Firestore event payload: %s", exc)
        return

    # Extract before/after status from proto (simple scalar field access)
    before_fields = payload._pb.old_value.fields
    after_fields = payload._pb.value.fields

    old_status = before_fields["status"].string_value if "status" in before_fields else ""
    new_status = after_fields["status"].string_value if "status" in after_fields else ""

    if new_status not in OUTCOME_STATUSES:
        return  # Not an outcome status — ignore
    if old_status == new_status:
        return  # Status unchanged — prevent double-processing

    # Extract bid_id from CloudEvent subject path
    # Format: "projects/{project}/databases/{db}/documents/{path}"
    subject = cloud_event.get_attributes().get("subject", "")
    bid_id = subject.rsplit("/", 1)[-1] if "/" in subject else ""

    if not bid_id:
        logger.error("Could not extract bid_id from subject: %s", subject)
        return

    # Read the full bid document from Firestore for complete data
    db = get_db()
    bid_ref = (
        db.collection("apps").document("vendy").collection("bids").document(bid_id)
    )
    bid_snap = bid_ref.get()
    if not bid_snap.exists:
        logger.error("Bid document %s not found in Firestore", bid_id)
        return

    bid = bid_snap.to_dict()
    vendor_id = bid.get("vendor_id", "")
    if not vendor_id:
        logger.error("bid %s has no vendor_id — skipping", bid_id)
        return

    project_id = bid.get("project_id", "")
    project_name = bid.get("project_name", "")
    cost_code = bid.get("cost_code", "")
    cost_code_name = bid.get("cost_code_name", "")
    subtotal = bid.get("subtotal")
    line_items = bid.get("line_items", [])

    logger.info(
        "on_bid_outcome: bid=%s vendor=%s cost_code=%s outcome=%s",
        bid_id, vendor_id, cost_code, new_status,
    )

    vendor_ref = (
        db.collection("apps").document("vendy")
        .collection("vendors").document(vendor_id)
    )

    _write_bid_ledger(
        vendor_ref, bid_id, project_id, project_name,
        cost_code, cost_code_name, new_status, subtotal, line_items,
    )
    _update_price_book(db, vendor_ref, cost_code, cost_code_name, new_status, line_items)


# ── bid_ledger (append-only) ───────────────────────────────────────────────────


def _write_bid_ledger(
    vendor_ref,
    bid_id: str,
    project_id: str,
    project_name: str,
    cost_code: str,
    cost_code_name: str,
    outcome: str,
    subtotal: float | None,
    line_items: list[dict],
) -> None:
    ledger_ref = vendor_ref.collection("bid_ledger").document(bid_id)
    if ledger_ref.get().exists:
        logger.info("bid_ledger entry already exists for bid=%s — skipping (append-only)", bid_id)
        return

    ledger_ref.set({
        "bid_id": bid_id,
        "project_id": project_id,
        "project_name": project_name,
        "cost_code": cost_code,
        "cost_code_name": cost_code_name,
        "outcome": outcome,
        "bid_date": date.today().isoformat(),
        "subtotal": subtotal,
        "line_items": line_items,
        "created_at": datetime.now(timezone.utc),
    })
    logger.info("bid_ledger entry written bid=%s vendor=%s outcome=%s", bid_id, vendor_ref.id, outcome)


# ── price_book rolling stats ──────────────────────────────────────────────────


@firestore.transactional
def _run_price_book_transaction(
    transaction,
    vendor_ref,
    cost_code: str,
    cost_code_name: str,
    outcome: str,
    line_items: list[dict],
) -> None:
    snapshot = vendor_ref.get(transaction=transaction)
    data = snapshot.to_dict() or {}

    price_book: dict = data.get("price_book") or {
        "last_updated": None,
        "bids_processed": 0,
        "categories": {},
    }
    categories: dict[str, Any] = price_book.setdefault("categories", {})
    code_key = cost_code if cost_code else "UNMATCHED"
    code_map: dict[str, Any] = categories.setdefault(code_key, {})

    for item in line_items:
        description = (item.get("description") or "").strip()
        if not description:
            continue

        unit_price = item.get("unit_price")
        extension = item.get("total")  # line item total is the extension value

        entry: dict = code_map.setdefault(description, {
            "cost_code_name": cost_code_name,
            "awarded": _empty_stats(),
            "not_awarded": _empty_stats(),
        })

        stats: dict = entry.setdefault(outcome, _empty_stats())
        today = date.today().isoformat()

        # unit_price may be None for lump-sum vendors — skip unit_price stats in that case
        if unit_price is not None:
            stats["unit_price"] = update_price_book_stats(stats["unit_price"], float(unit_price))

        # extension (line total) is always tracked when present
        if extension is not None:
            stats["extension"] = update_price_book_stats(stats["extension"], float(extension))

        stats["last_seen"] = today
        entry[outcome] = stats
        code_map[description] = entry

    categories[code_key] = code_map
    price_book["categories"] = categories
    price_book["last_updated"] = datetime.now(timezone.utc).isoformat()
    price_book["bids_processed"] = int(price_book.get("bids_processed") or 0) + 1

    transaction.update(vendor_ref, {"price_book": price_book})


def _update_price_book(
    db,
    vendor_ref,
    cost_code: str,
    cost_code_name: str,
    outcome: str,
    line_items: list[dict],
) -> None:
    transaction = db.transaction()
    _run_price_book_transaction(
        transaction, vendor_ref, cost_code, cost_code_name, outcome, line_items
    )
    logger.info(
        "price_book updated vendor=%s code=%s outcome=%s items=%d",
        vendor_ref.id, cost_code, outcome, len(line_items),
    )


# ── Stats helpers (public for testing) ────────────────────────────────────────


def update_price_book_stats(stats: dict, new_value: float) -> dict:
    """
    Compute new running min/max/avg/sample_count given one new observation.
    Uses Welford-style incremental mean: new_avg = (old_avg * n + new_value) / (n+1)
    """
    n = int(stats.get("sample_count") or 0)
    old_avg = stats.get("avg")
    old_min = stats.get("min")
    old_max = stats.get("max")

    new_count = n + 1
    new_avg = (float(old_avg or 0) * n + new_value) / new_count
    new_min = min(float(old_min), new_value) if old_min is not None else new_value
    new_max = max(float(old_max), new_value) if old_max is not None else new_value

    return {
        "min": round(new_min, 4),
        "max": round(new_max, 4),
        "avg": round(new_avg, 4),
        "sample_count": new_count,
    }


def _empty_stats() -> dict:
    return {
        "unit_price": {"min": None, "max": None, "avg": None, "sample_count": 0},
        "extension": {"min": None, "max": None, "avg": None, "sample_count": 0},
        "last_seen": None,
    }
