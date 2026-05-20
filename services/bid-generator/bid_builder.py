"""
Pricing priority lookup and bid orchestration.

get_price_for_item   — 4-tier lookup following CLAUDE.md priority order
build_bid_for_vendor — calls Claude with priority-ordered pricing context
process_approved_takeoff — full automated pipeline triggered by Pub/Sub
"""
from __future__ import annotations

import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import anthropic
from json_repair import repair_json

logger = logging.getLogger(__name__)

MODEL_VERSION = os.environ.get("MODEL_VERSION", "claude-opus-4-6")

_client: anthropic.Anthropic | None = None

# ── Section ID → Cost Code mapping ───────────────────────────────────────────
# Moved here from main.py so process_approved_takeoff can use it without
# creating a circular import.
SECTION_TO_COST_CODES: dict[str, list[str]] = {
    "foundation_concrete": ["3100", "3000"],
    "framing": ["3210", "3000"],
    "roofing": ["3400"],
    "windows_doors": ["3300", "3310"],
    "electrical": ["3800", "3830"],
    "plumbing": ["3600", "3610"],
    "hvac": ["3700"],
    "insulation": ["4700"],
    "drywall_finishes": ["5000"],
    "exterior_finishes": ["4600", "4100", "4110", "3500"],
    "excavation": ["2000"],
    "site_prep": ["2000", "1300"],
    "landscaping": ["6200", "6310"],
    "garage": ["4650"],
    "flooring": ["5100", "5120", "5160", "5170"],
    "interior_finishes": ["5200", "5400", "5211"],
    "appliances": ["5900"],
    "cabinets": ["5400", "5500"],
    "stairs": ["3900"],
    "miscellaneous": ["8200O", "8100O"],
}


def _resolve_cost_code(section: dict, biddable: dict) -> str | None:
    """Return the best cost_code for a section, or None if not biddable."""
    explicit = section.get("cost_code", "")
    if explicit and explicit in biddable:
        return explicit
    section_id = section.get("section_id", "")
    for code in SECTION_TO_COST_CODES.get(section_id, []):
        if code in biddable:
            return code
    return None


# ── Description matching ─────────────────────────────────────────────────────


def _tokens(text: str) -> set[str]:
    return set(re.sub(r"[^a-z0-9 ]", " ", text.lower()).split())


def _match_score(query: str, candidate: str) -> float:
    """Word-overlap ratio between query and candidate (0.0–1.0)."""
    q = _tokens(query)
    c = _tokens(candidate)
    if not q or not c:
        return 0.0
    return len(q & c) / min(len(q), len(c))


# ── Pricing priority lookup ───────────────────────────────────────────────────

_MATCH_THRESHOLD = 0.25


def get_price_for_item(
    vendor_doc: dict, cost_code: str, item_description: str
) -> tuple[dict, str]:
    """
    Return (price_data, source_flag) for one takeoff item, following CLAUDE.md:

      1. price_book.awarded  (sample_count > 0)  → "awarded"
      2. price_book.not_awarded                  → "directional"
      3. Legacy pricing_profile                  → "legacy"
      4. No data anywhere                        → "no_history"

    price_data keys: history_description, unit_price, extension, source, note (optional)
    unit_price may be None for lump-sum vendors (extension holds the total).
    """
    # ── 1 & 2: price_book ────────────────────────────────────────────────────
    pb_cats: dict = (
        vendor_doc.get("price_book", {}).get("categories", {}).get(cost_code, {})
    )

    best_name, best_score = _best_match(item_description, pb_cats)

    if best_name is not None:
        entry = pb_cats[best_name]

        # Tier 1 — awarded
        awarded = entry.get("awarded", {})
        if awarded.get("sample_count", 0) > 0:
            return {
                "history_description": best_name,
                "unit_price": awarded.get("unit_price", {}).get("avg"),
                "extension": awarded.get("extension", {}).get("avg"),
                "source": "history",
            }, "awarded"

        # Tier 2 — not_awarded (directional)
        na = entry.get("not_awarded", {})
        na_unit = na.get("unit_price", {}).get("avg")
        na_ext = na.get("extension", {}).get("avg")
        if na_unit is not None or na_ext is not None:
            return {
                "history_description": best_name,
                "unit_price": na_unit,
                "extension": na_ext,
                "source": "history",
                "note": "Based on non-awarded bids only — treat as directional.",
            }, "directional"

    # ── 3: Legacy pricing_profile ─────────────────────────────────────────────
    pp_cats: dict = (
        vendor_doc.get("pricing_profile", {})
        .get("categories", {})
        .get(cost_code, {})
    )
    best_name, _ = _best_match(item_description, pp_cats)
    if best_name is not None:
        return {
            "history_description": best_name,
            "data": pp_cats[best_name],
            "source": "history",
            "note": (
                "Sourced from legacy pricing history — pre-dates structured bid model."
            ),
        }, "legacy"

    # ── 4: No data ────────────────────────────────────────────────────────────
    return {"source": "generated"}, "no_history"


def _best_match(description: str, entries: dict) -> tuple[str | None, float]:
    """Return (best_matching_key, score) from entries, or (None, 0.0)."""
    best_name, best_score = None, 0.0
    for name in entries:
        s = _match_score(description, name)
        if s > best_score:
            best_name, best_score = name, s
    if best_score < _MATCH_THRESHOLD:
        return None, 0.0
    return best_name, best_score


# ── Claude client ─────────────────────────────────────────────────────────────


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


def _load_prompt() -> str:
    return (Path(__file__).parent / "prompts" / "bid_v1.md").read_text()


# ── Bid builder ───────────────────────────────────────────────────────────────


async def build_bid_for_vendor(
    bid_id: str,
    takeoff_items: list[dict],
    vendor_doc: dict,
    cost_code: str,
    cost_code_name: str,
    vendor_id: str,
) -> dict:
    """
    Build one bid using priority-ordered pricing context.
    Returns a dict with line_items, subtotal, generation_notes, status,
    generated_at, and _flags (internal; caller strips before Firestore write).
    """
    import asyncio

    system_prompt = _load_prompt()
    vendor_name = vendor_doc.get("name", vendor_id)

    # Build per-item pricing context with priority order applied
    pricing_context = []
    flags: list[str] = []
    source_notes: list[str] = []

    for item in takeoff_items:
        price_data, flag = get_price_for_item(
            vendor_doc, cost_code, item.get("description", "")
        )
        flags.append(flag)
        quantity = item.get("pm_override") if item.get("pm_override") is not None else item.get("quantity")
        pricing_context.append(
            {
                "takeoff_description": item.get("description", ""),
                "quantity": quantity,
                "unit": item.get("unit", ""),
                **price_data,
            }
        )
        if flag == "directional":
            source_notes.append(
                f"'{item.get('description', '')}': non-awarded history only — directional."
            )
        elif flag == "legacy":
            source_notes.append(
                f"'{item.get('description', '')}': legacy pricing history."
            )
        elif flag == "no_history":
            source_notes.append(
                f"'{item.get('description', '')}': no pricing history — estimated."
            )

    user_message = (
        f"Cost Code: {cost_code} — {cost_code_name}\n"
        f"Vendor: {vendor_name}\n\n"
        f"PRICING CONTEXT (priority-ordered per item):\n"
        f"{json.dumps(pricing_context, indent=2, default=str)}\n\n"
        "Generate the bid line items for this vendor."
    )

    def _call() -> str:
        msg = _get_client().messages.create(
            model=MODEL_VERSION,
            max_tokens=4096,
            system=system_prompt,
            messages=[{"role": "user", "content": user_message}],
        )
        return msg.content[0].text

    raw = await asyncio.to_thread(_call)

    try:
        result = json.loads(raw)
    except json.JSONDecodeError:
        result = json.loads(repair_json(raw))

    line_items = result.get("line_items", [])
    for item in line_items:
        item.setdefault("takeoff_ref", "")

    has_null_total = any(i.get("total") is None for i in line_items)
    subtotal = (
        None
        if has_null_total
        else round(sum(i.get("total") or 0 for i in line_items), 2)
    )

    notes_parts = [result.get("generation_notes") or ""]
    if source_notes:
        notes_parts.append("Pricing sources: " + "; ".join(source_notes))
    generation_notes = "\n".join(n for n in notes_parts if n).strip() or None

    return {
        "line_items": line_items,
        "subtotal": subtotal,
        "generation_notes": generation_notes,
        "status": "needs_review",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "_flags": flags,
    }


# ── Full pipeline ─────────────────────────────────────────────────────────────


async def process_approved_takeoff(project_id: str) -> dict:
    """
    Automated bid generation for a newly approved takeoff.
    Called by the Pub/Sub subscriber and by the /process HTTP endpoint.
    """
    import asyncio

    import firestore_client as fs

    logger.info("process_approved_takeoff start project=%s", project_id)

    takeoff = fs.get_approved_takeoff(project_id)
    if not takeoff:
        logger.warning("No approved takeoff for %s — skipping", project_id)
        return {"skipped": True, "reason": "no_approved_takeoff"}

    project_name = takeoff.get("project_name", "")
    biddable = {c["code_id"]: c for c in fs.list_biddable_cost_codes()}

    tasks = []
    bids_created = 0

    for section in takeoff.get("sections", []):
        cost_code = _resolve_cost_code(section, biddable)
        if not cost_code:
            continue
        code_doc = biddable[cost_code]
        takeoff_items = section.get("items", [])
        if not takeoff_items:
            continue

        vendors = fs.get_vendors_for_cost_code(cost_code)
        for vendor in vendors:
            vid = vendor.get("vendor_id", "")
            vname = vendor.get("name", vid)
            ccname = code_doc.get("name", "")

            bid_id = fs.create_bid(
                project_id=project_id,
                project_name=project_name,
                vendor_id=vid,
                vendor_name=vname,
                cost_code=cost_code,
                cost_code_name=ccname,
            )
            bids_created += 1

            async def _run(
                bid_id=bid_id,
                items=takeoff_items,
                vendor=vendor,
                cc=cost_code,
                ccn=ccname,
                vid=vid,
            ):
                try:
                    result = await build_bid_for_vendor(
                        bid_id=bid_id,
                        takeoff_items=items,
                        vendor_doc=vendor,
                        cost_code=cc,
                        cost_code_name=ccn,
                        vendor_id=vid,
                    )
                    flags = result.pop("_flags", [])
                    fs.update_bid_with_result(
                        bid_id,
                        result["line_items"],
                        result["subtotal"],
                        result["generation_notes"],
                    )
                    fs.log_run(
                        {
                            "run_id": str(uuid.uuid4()),
                            "trigger": "pubsub",
                            "project_id": project_id,
                            "vendor_id": vid,
                            "cost_code": cc,
                            "bid_id": bid_id,
                            "model": MODEL_VERSION,
                            "pricing_flags": flags,
                            "status": "ok",
                            "error": None,
                            "created_at": datetime.now(timezone.utc),
                        }
                    )
                except Exception as exc:
                    logger.error("build_bid_for_vendor failed bid=%s: %s", bid_id, exc)
                    fs.update_bid_status_failed(bid_id, str(exc))
                    fs.log_run(
                        {
                            "run_id": str(uuid.uuid4()),
                            "trigger": "pubsub",
                            "project_id": project_id,
                            "vendor_id": vid,
                            "cost_code": cc,
                            "bid_id": bid_id,
                            "model": MODEL_VERSION,
                            "status": "error",
                            "error": str(exc),
                            "created_at": datetime.now(timezone.utc),
                        }
                    )

            tasks.append(_run())

    await asyncio.gather(*tasks, return_exceptions=True)

    logger.info(
        "process_approved_takeoff done project=%s bids_created=%d",
        project_id,
        bids_created,
    )
    return {"project_id": project_id, "bids_created": bids_created}
