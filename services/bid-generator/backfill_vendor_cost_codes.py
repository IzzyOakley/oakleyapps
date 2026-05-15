"""
backfill_vendor_cost_codes.py
------------------------------
Reads every vendor's pricing_profile.categories and writes their vendor_id
into the vendors[] array on the matching cost_code documents.

Run once (and re-run whenever vendor profiles change):
  python3 backfill_vendor_cost_codes.py
"""

from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

from google.cloud import firestore

db = firestore.Client(project="buildertrend-pipeline")


def run():
    # ── 1. Load all cost codes ────────────────────────────────────────────────
    cc_docs = list(
        db.collection("apps").document("shared").collection("cost_codes").stream()
    )
    cost_code_ids = {d.id for d in cc_docs}
    print(f"Loaded {len(cc_docs)} cost codes")

    # ── 2. Load all vendors (skip _schema sentinel) ───────────────────────────
    vendor_docs = list(
        db.collection("apps").document("vendy").collection("vendors").stream()
    )
    vendor_docs = [v for v in vendor_docs if not v.id.startswith("_")]
    print(f"Loaded {len(vendor_docs)} vendors")

    # ── 3. Build reverse map: cost_code_id → [vendor_id, ...] ────────────────
    code_to_vendors: dict[str, list[str]] = {}

    for vendor_doc in vendor_docs:
        data = vendor_doc.to_dict() or {}
        categories: dict = (data.get("pricing_profile") or {}).get("categories") or {}
        for code_id in categories.keys():
            if code_id == "UNMATCHED":
                continue
            if code_id not in cost_code_ids:
                # Vendor has a code not in our master list — skip gracefully
                continue
            code_to_vendors.setdefault(code_id, [])
            if vendor_doc.id not in code_to_vendors[code_id]:
                code_to_vendors[code_id].append(vendor_doc.id)

    print(f"Mapped vendors to {len(code_to_vendors)} distinct cost codes")

    # ── 4. Write vendors[] to each cost code (only codes with ≥1 vendor) ─────
    batch = db.batch()
    batch_count = 0
    updated = 0

    for code_id, vendor_ids in code_to_vendors.items():
        ref = (
            db.collection("apps")
            .document("shared")
            .collection("cost_codes")
            .document(code_id)
        )
        batch.update(ref, {"vendors": sorted(vendor_ids)})
        batch_count += 1
        updated += 1

        # Firestore batch limit is 500 writes
        if batch_count == 490:
            batch.commit()
            batch = db.batch()
            batch_count = 0

    if batch_count:
        batch.commit()

    print(f"✓ Updated {updated} cost codes with vendor lists")

    # ── 5. Clear vendors[] on codes that have NO vendors ──────────────────────
    codes_with_no_vendors = [d.id for d in cc_docs if d.id not in code_to_vendors]
    if codes_with_no_vendors:
        batch = db.batch()
        batch_count = 0
        for code_id in codes_with_no_vendors:
            ref = (
                db.collection("apps")
                .document("shared")
                .collection("cost_codes")
                .document(code_id)
            )
            batch.update(ref, {"vendors": []})
            batch_count += 1
            if batch_count == 490:
                batch.commit()
                batch = db.batch()
                batch_count = 0
        if batch_count:
            batch.commit()
        print(
            f"  Cleared vendors[] on {len(codes_with_no_vendors)} codes with no vendor coverage"
        )

    # ── 6. Summary ────────────────────────────────────────────────────────────
    print("\nTop 10 cost codes by vendor count:")
    top = sorted(code_to_vendors.items(), key=lambda x: len(x[1]), reverse=True)[:10]
    for code_id, vids in top:
        # Find code name
        name = next(
            (d.to_dict().get("name", "") for d in cc_docs if d.id == code_id), ""
        )
        print(f"  {code_id} {name}: {len(vids)} vendors")


if __name__ == "__main__":
    run()
