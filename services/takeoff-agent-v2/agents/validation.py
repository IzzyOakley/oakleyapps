"""
Validation Agent (Phase 13).

Post-run cost-variance analysis with a Claude plain-English summary.

Compares each completed cost code's estimate_final_cost against the price-book
historical average awarded extension.  Items with > 20% variance are flagged.
Claude writes a 3-5 paragraph summary for the PM to review before approval.

Input
-----
  project_id      : str
  cost_code_docs  : list[dict]  — all cost_codes sub-documents after agents ran
  price_book_data : dict        — {vendor_id: price_book_dict} from firestore

Output (validation report dict)
--------------------------------
  {
    "project_id": str,
    "job_name": str,
    "summary_stats": {
      "total_codes": int,
      "complete": int,
      "failed": int,
      "manual_required": int,
      "skipped": int,
      "flagged": int,          # > 20% variance
      "no_price_book": int,    # complete but no PB comparison available
    },
    "items": [
      {
        "cost_code": str,
        "cost_code_name": str,
        "agent_status": str,
        "quantity": float | None,
        "unit": str | None,
        "estimate_final_cost": float | None,
        "implied_unit_cost": float | None,
        "pb_avg_extension": float | None,
        "variance_pct": float | None,
        "flagged": bool,
      },
      ...
    ],
    "claude_summary": str | None,
    "validation_status": "complete" | "no_price_book_data" | "claude_error",
    "model": str | None,
    "input_tokens": int | None,
    "output_tokens": int | None,
    "duration_ms": int | None,
  }

Flags (stored in validation_status field, not a list):
  complete           — analysis ran and Claude summary produced
  no_price_book_data — no price book entries found for any code (Claude still runs)
  claude_api_error   — Claude call failed; report still returned without summary
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

import anthropic

_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "validation_v1.md"

_VARIANCE_THRESHOLD_PCT = 20.0  # flag if abs(variance) exceeds this


# ── Price-book helpers ────────────────────────────────────────────────────────


def _pb_avg_extension(cost_code: str, price_book_data: dict) -> float | None:
    """
    Return the average total awarded extension for a cost code across all vendors.

    Strategy: for each vendor, sum the avg extension across all item descriptions
    under that cost code, then average those vendor totals.
    """
    vendor_totals: list[float] = []
    for _vendor_id, pb in price_book_data.items():
        cats = pb.get("categories", {})
        cc_items = cats.get(cost_code, {})
        if not cc_items:
            continue
        total = 0.0
        for _item_desc, item_data in cc_items.items():
            avg = (
                item_data.get("awarded", {}).get("extension", {}).get("avg")
            )
            if avg is not None:
                total += float(avg)
        if total > 0:
            vendor_totals.append(total)

    if not vendor_totals:
        return None
    return sum(vendor_totals) / len(vendor_totals)


# ── Variance analysis ─────────────────────────────────────────────────────────


def _analyze_items(
    cost_code_docs: list[dict],
    price_book_data: dict,
) -> list[dict]:
    """Build the per-code analysis list."""
    items: list[dict] = []
    for doc in cost_code_docs:
        code = doc.get("cost_code", "")
        status = doc.get("agent_status", "pending")
        quantity = doc.get("quantity")
        unit = doc.get("unit")
        estimate_cost = doc.get("estimate_final_cost")

        # Implied unit cost
        implied_unit_cost: float | None = None
        if quantity and quantity > 0 and estimate_cost is not None:
            implied_unit_cost = round(float(estimate_cost) / float(quantity), 4)

        # Price-book average extension
        pb_avg = _pb_avg_extension(code, price_book_data)

        # Variance vs price-book (compare total estimate cost, not unit cost)
        variance_pct: float | None = None
        if pb_avg and pb_avg > 0 and estimate_cost is not None:
            variance_pct = round(
                (float(estimate_cost) - pb_avg) / pb_avg * 100.0, 2
            )

        flagged = (
            variance_pct is not None
            and abs(variance_pct) > _VARIANCE_THRESHOLD_PCT
        )

        items.append(
            {
                "cost_code": code,
                "cost_code_name": doc.get("cost_code_name", ""),
                "agent_status": status,
                "quantity": quantity,
                "unit": unit,
                "estimate_final_cost": estimate_cost,
                "implied_unit_cost": implied_unit_cost,
                "pb_avg_extension": round(pb_avg, 2) if pb_avg is not None else None,
                "variance_pct": variance_pct,
                "flagged": flagged,
            }
        )
    return items


# ── Claude summary ────────────────────────────────────────────────────────────


def _call_claude(
    analysis_payload: dict,
    model: str,
    api_key: str,
) -> tuple[str, int, int, int]:
    """
    Call Claude with the analysis payload and return
    (summary_text, input_tokens, output_tokens, duration_ms).
    """
    try:
        system_prompt = _PROMPT_PATH.read_text()
    except Exception:
        system_prompt = (
            "You are a construction cost analyst. "
            "Summarize the takeoff validation results in plain English for a PM."
        )

    user_message = json.dumps(analysis_payload, default=str)

    client = anthropic.Anthropic(api_key=api_key)
    t0 = time.monotonic()
    response = client.messages.create(
        model=model,
        max_tokens=1024,
        system=system_prompt,
        messages=[{"role": "user", "content": user_message}],
    )
    duration_ms = round((time.monotonic() - t0) * 1000)
    summary = response.content[0].text.strip()
    return (
        summary,
        response.usage.input_tokens,
        response.usage.output_tokens,
        duration_ms,
    )


# ── ValidationAgent ───────────────────────────────────────────────────────────


class ValidationAgent:
    """
    Post-run validation: variance analysis + Claude plain-English summary.

    Not a BaseAgent subclass — takes project-level data rather than per-code
    SharedParams.  Called by the run-all background task after all agents finish.
    """

    def run(
        self,
        project_id: str,
        job_name: str,
        cost_code_docs: list[dict],
        price_book_data: dict,
    ) -> dict:
        """
        Run validation and return a report dict.

        Always returns a report even if Claude fails — the claude_summary
        field will be None and validation_status will reflect the error.
        """
        items = _analyze_items(cost_code_docs, price_book_data)

        # Summary stats
        total = len(items)
        by_status: dict[str, int] = {}
        for it in items:
            s = it["agent_status"]
            by_status[s] = by_status.get(s, 0) + 1

        flagged_count = sum(1 for it in items if it["flagged"])
        no_pb_count = sum(
            1
            for it in items
            if it["agent_status"] == "complete" and it["pb_avg_extension"] is None
        )

        summary_stats = {
            "total_codes": total,
            "complete": by_status.get("complete", 0),
            "failed": by_status.get("failed", 0),
            "manual_required": by_status.get("manual_required", 0),
            "skipped": by_status.get("skipped", 0),
            "flagged": flagged_count,
            "no_price_book": no_pb_count,
        }

        analysis_payload = {
            "project_id": project_id,
            "job_name": job_name,
            "summary_stats": summary_stats,
            "items": items,
        }

        # ── Claude call ───────────────────────────────────────────────────────
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        model = os.environ.get("MODEL_VERSION", "claude-opus-4-5")
        claude_summary: str | None = None
        input_tokens: int | None = None
        output_tokens: int | None = None
        duration_ms: int | None = None
        validation_status = "complete"

        if not api_key:
            validation_status = "claude_api_error"
        else:
            try:
                claude_summary, input_tokens, output_tokens, duration_ms = (
                    _call_claude(analysis_payload, model, api_key)
                )
            except Exception as exc:
                validation_status = f"claude_api_error:{exc!s}"

        if not price_book_data and validation_status == "complete":
            validation_status = "no_price_book_data"

        report = {
            "project_id": project_id,
            "job_name": job_name,
            "summary_stats": summary_stats,
            "items": items,
            "claude_summary": claude_summary,
            "validation_status": validation_status,
            "model": model if claude_summary else None,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "duration_ms": duration_ms,
        }
        return report
