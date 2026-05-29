"""
Historical-Average Agent — derives a quantity from vendor price_book awarded data.

price_book structure (from apps/vendy/vendors/{slug}):
  price_book.categories.{cost_code}.{item_description}.awarded.extension.avg
  price_book.categories.{cost_code}.{item_description}.awarded.extension.sample_count

The agent collects all awarded avg extensions for this cost_code across all
vendors, then returns the median as the estimated quantity.

quantity is always None (the output is a price extension, not a unit quantity).
unit is always LS.
confidence: medium if >= 3 awarded samples total; low otherwise.
"""

from __future__ import annotations

import statistics

from agents.base import BaseAgent
from schemas import AgentOutput, SharedParams


class HistoricalAvgAgent(BaseAgent):
    """
    Reads vendor price_books passed in from the caller (never fetches Firestore itself).
    Returns the median of all awarded avg extensions for this cost code.
    """

    def run(
        self,
        shared_params: SharedParams,
        price_book_data: dict,
        dxf_local_path: str | None = None,
    ) -> AgentOutput:
        """
        price_book_data: {vendor_id: price_book_doc}
        price_book_doc has structure: {categories: {cost_code: {item_desc: {awarded: ...}}}}
        """
        unit = self.config.get("unit", "LS")
        cost_code = self.cost_code

        vendor_samples: list[dict] = []

        for vendor_id, price_book in price_book_data.items():
            categories = price_book.get("categories", {})
            code_data = categories.get(cost_code, {})

            for item_desc, item_data in code_data.items():
                awarded = item_data.get("awarded", {})
                ext = awarded.get("extension", {})
                avg = ext.get("avg")
                sample_count = ext.get("sample_count", 0)

                if (
                    avg is not None
                    and isinstance(sample_count, int)
                    and sample_count > 0
                ):
                    vendor_samples.append(
                        {
                            "vendor_id": vendor_id,
                            "avg": float(avg),
                            "count": sample_count,
                            "item_description": item_desc,
                        }
                    )

        if not vendor_samples:
            return AgentOutput(
                quantity=None,
                unit=unit,
                output={
                    "avg_awarded_extension": None,
                    "sample_count": 0,
                    "vendors_sampled": [],
                },
                source="historical_avg",
                confidence="low",
                notes="No price_book data — manual entry recommended.",
                flags=["no_price_book_data"],
            )

        extensions = [s["avg"] for s in vendor_samples]
        median_ext = statistics.median(extensions)
        total_samples = sum(s["count"] for s in vendor_samples)

        vendors_summary = [
            {"vendor_id": s["vendor_id"], "avg": s["avg"], "count": s["count"]}
            for s in vendor_samples
        ]

        n_entries = len(vendor_samples)
        confidence = "medium" if total_samples >= 3 else "low"

        return AgentOutput(
            quantity=None,
            unit=unit,
            output={
                "avg_awarded_extension": round(median_ext, 2),
                "sample_count": total_samples,
                "vendors_sampled": vendors_summary,
            },
            source="historical_avg",
            confidence=confidence,
            notes=(
                f"Based on {total_samples} awarded bid(s) across "
                f"{n_entries} price_book entr{'y' if n_entries == 1 else 'ies'}."
            ),
            flags=[],
        )
