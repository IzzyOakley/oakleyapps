#!/usr/bin/env python3
"""
Seed agent_type and agent_config fields on all apps/shared/cost_codes documents.

Run once against buildertrend-pipeline after Phase 7 is deployed:

  FIREBASE_PROJECT_ID=buildertrend-pipeline \
  GOOGLE_APPLICATION_CREDENTIALS=/path/to/buildertrend-pipeline-key.json \
  python3 scripts/seed_agent_types.py

Idempotent — safe to re-run. Only writes fields that have changed.
"""

import os
import sys

# Allow running from the monorepo root
sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "services", "takeoff-agent-v2"),
)

from dotenv import load_dotenv

load_dotenv()

from google.cloud import firestore

from agent_registry import AGENT_REGISTRY


def get_db() -> firestore.Client:
    project = os.environ.get("FIREBASE_PROJECT_ID", "buildertrend-pipeline")
    return firestore.Client(project=project)


def main() -> None:
    db = get_db()
    cost_codes_ref = db.collection("apps").document("shared").collection("cost_codes")
    docs = list(cost_codes_ref.stream())
    print(f"Found {len(docs)} cost code documents.\n")

    updated = 0
    skipped = 0
    warnings = []

    for doc in docs:
        data = doc.to_dict() or {}
        full_code = data.get("full_code") or doc.id

        # Profit items never run agents
        if data.get("is_profit_item", False):
            agent_type = "skip"
            agent_config: dict = {}
        elif full_code in AGENT_REGISTRY:
            entry = AGENT_REGISTRY[full_code]
            agent_type = entry["agent_type"]
            agent_config = entry["agent_config"]
        else:
            msg = f"  [WARN] {full_code} ({data.get('name', '')}) — not in AGENT_REGISTRY, defaulting to manual_hold"
            warnings.append(msg)
            agent_type = "manual_hold"
            agent_config = {"note": "Not in agent registry — manual entry required."}

        # Only write when something actually changed (idempotency)
        if data.get("agent_type") == agent_type and data.get("agent_config") == agent_config:
            skipped += 1
            continue

        cost_codes_ref.document(doc.id).update(
            {"agent_type": agent_type, "agent_config": agent_config}
        )
        updated += 1
        print(f"  Updated {full_code} — {data.get('name', '')} → {agent_type}")

    if warnings:
        print()
        for w in warnings:
            print(w)

    print(f"\nDone. {updated} updated, {skipped} already up-to-date.")


if __name__ == "__main__":
    main()
