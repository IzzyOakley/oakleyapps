import os
import uuid
from datetime import datetime, timezone
from google.cloud import firestore

_db = None


def get_db() -> firestore.Client:
    global _db
    if _db is None:
        project = os.environ.get("FIREBASE_PROJECT_ID", "buildertrend-pipeline")
        _db = firestore.Client(project=project)
    return _db


def get_approved_takeoff(project_id: str) -> dict | None:
    db = get_db()
    doc = (
        db.collection("apps")
        .document("shared")
        .collection("takeoffs")
        .document(project_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"project_id": doc.id, **doc.to_dict()}


def list_cost_codes() -> list[dict]:
    db = get_db()
    docs = db.collection("apps").document("shared").collection("cost_codes").stream()
    return [{"code_id": d.id, **d.to_dict()} for d in docs]


def list_biddable_cost_codes() -> list[dict]:
    all_codes = list_cost_codes()
    return [
        c for c in all_codes if c.get("flags", {}).get("biddable") and c.get("vendors")
    ]


def get_vendor(vendor_id: str) -> dict | None:
    db = get_db()
    doc = (
        db.collection("apps")
        .document("vendy")
        .collection("vendors")
        .document(vendor_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"vendor_id": doc.id, **doc.to_dict()}


def get_project(project_id: str) -> dict | None:
    db = get_db()
    doc = (
        db.collection("apps")
        .document("shared")
        .collection("projects")
        .document(project_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"project_id": doc.id, **doc.to_dict()}


def create_bid(
    project_id, project_name, vendor_id, vendor_name, cost_code, cost_code_name
) -> str:
    db = get_db()
    bid_id = str(uuid.uuid4())
    db.collection("apps").document("vendy").collection("bids").document(bid_id).set(
        {
            "bid_id": bid_id,
            "project_id": project_id,
            "project_name": project_name,
            "vendor_id": vendor_id,
            "vendor_name": vendor_name,
            "cost_code": cost_code,
            "cost_code_name": cost_code_name,
            "status": "generating",
            "line_items": [],
            "subtotal": None,
            "generated_at": None,
            "approved_at": None,
            "approved_by": None,
            "pdf_gcs_path": None,
            "generation_notes": None,
        }
    )
    return bid_id


def update_bid_with_result(bid_id, line_items, subtotal, generation_notes) -> None:
    db = get_db()
    db.collection("apps").document("vendy").collection("bids").document(bid_id).update(
        {
            "line_items": line_items,
            "subtotal": subtotal,
            "status": "needs_review",
            "generated_at": datetime.now(timezone.utc),
            "generation_notes": generation_notes,
        }
    )


def update_bid_status_failed(bid_id, error) -> None:
    db = get_db()
    db.collection("apps").document("vendy").collection("bids").document(bid_id).update(
        {
            "status": "failed",
            "generation_notes": f"Generation failed: {error}",
        }
    )


def get_bid(bid_id) -> dict | None:
    db = get_db()
    doc = (
        db.collection("apps")
        .document("vendy")
        .collection("bids")
        .document(bid_id)
        .get()
    )
    if not doc.exists:
        return None
    return {"bid_id": doc.id, **doc.to_dict()}


def list_bids_for_project(project_id) -> list[dict]:
    db = get_db()
    docs = (
        db.collection("apps")
        .document("vendy")
        .collection("bids")
        .where(filter=firestore.FieldFilter("project_id", "==", project_id))
        .stream()
    )
    return [{"bid_id": d.id, **d.to_dict()} for d in docs]


def list_all_bids() -> list[dict]:
    db = get_db()
    docs = db.collection("apps").document("vendy").collection("bids").stream()
    return [{"bid_id": d.id, **d.to_dict()} for d in docs]


def update_line_item(bid_id, idx, unit_price, quantity, notes) -> bool:
    db = get_db()
    ref = db.collection("apps").document("vendy").collection("bids").document(bid_id)
    doc = ref.get()
    if not doc.exists:
        return False
    data = doc.to_dict()
    items = data.get("line_items", [])
    if idx < 0 or idx >= len(items):
        return False
    if unit_price is not None:
        items[idx]["unit_price"] = unit_price
        q = items[idx].get("quantity")
        if q is not None:
            items[idx]["total"] = round(unit_price * q, 2)
    if quantity is not None:
        items[idx]["quantity"] = quantity
        up = items[idx].get("unit_price")
        if up is not None:
            items[idx]["total"] = round(up * quantity, 2)
    if notes is not None:
        items[idx]["notes"] = notes
    subtotal = sum(i.get("total") or 0 for i in items)
    ref.update({"line_items": items, "subtotal": subtotal})
    return True


def approve_bid(bid_id, approved_by) -> bool:
    db = get_db()
    ref = db.collection("apps").document("vendy").collection("bids").document(bid_id)
    doc = ref.get()
    if not doc.exists:
        return False
    ref.update(
        {
            "status": "approved",
            "approved_at": datetime.now(timezone.utc),
            "approved_by": approved_by,
        }
    )
    return True


def update_bid_pdf_path(bid_id, gcs_path) -> None:
    db = get_db()
    db.collection("apps").document("vendy").collection("bids").document(bid_id).update(
        {
            "pdf_gcs_path": gcs_path,
        }
    )
