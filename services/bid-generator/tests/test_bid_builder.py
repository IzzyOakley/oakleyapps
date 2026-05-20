"""
Unit tests for bid_builder.get_price_for_item — all 4 pricing tiers.

Run from services/bid-generator/:
  pip install pytest
  pytest tests/test_bid_builder.py -v
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from bid_builder import get_price_for_item  # noqa: E402


# ── Fixtures ──────────────────────────────────────────────────────────────────

COST_CODE = "3700"
ITEM_DESC = "Mechanical system — forced air furnace and AC"


def _vendor(price_book_entry=None, legacy_entry=None) -> dict:
    """Build a minimal vendor_doc for testing."""
    doc: dict = {"name": "Test HVAC Co", "active": True}

    if price_book_entry is not None:
        doc["price_book"] = {
            "categories": {
                COST_CODE: {
                    # Description contains key words from ITEM_DESC so matching fires
                    "Mechanical system — HVAC complete": price_book_entry,
                }
            }
        }

    if legacy_entry is not None:
        doc["pricing_profile"] = {
            "categories": {
                COST_CODE: {
                    "Mechanical system — HVAC complete": legacy_entry,
                }
            }
        }

    return doc


# ── Case 1a: awarded with unit price ─────────────────────────────────────────


def test_awarded_with_unit_price():
    vendor = _vendor(
        price_book_entry={
            "awarded": {
                "sample_count": 3,
                "unit_price": {"avg": 5_000.0, "min": 4_500.0, "max": 5_500.0},
                "extension": {"avg": 45_000.0, "min": 40_000.0, "max": 50_000.0},
            },
            "not_awarded": {
                "sample_count": 0,
                "unit_price": {"avg": None, "min": None, "max": None},
                "extension": {"avg": None, "min": None, "max": None},
            },
        }
    )

    price_data, flag = get_price_for_item(vendor, COST_CODE, ITEM_DESC)

    assert flag == "awarded"
    assert price_data["source"] == "history"
    assert price_data["unit_price"] == 5_000.0
    assert price_data["extension"] == 45_000.0
    assert "note" not in price_data


# ── Case 1b: awarded with null unit_price (lump-sum vendor) ──────────────────


def test_awarded_lump_sum_null_unit_price():
    """Lump-sum vendors store the job total in extension, not unit_price."""
    vendor = _vendor(
        price_book_entry={
            "awarded": {
                "sample_count": 2,
                "unit_price": {"avg": None, "min": None, "max": None},
                "extension": {"avg": 44_450.0, "min": 42_000.0, "max": 46_900.0},
            },
            "not_awarded": {
                "sample_count": 0,
                "unit_price": {"avg": None, "min": None, "max": None},
                "extension": {"avg": None, "min": None, "max": None},
            },
        }
    )

    price_data, flag = get_price_for_item(vendor, COST_CODE, ITEM_DESC)

    assert flag == "awarded"
    assert price_data["source"] == "history"
    assert price_data["unit_price"] is None, "lump-sum vendor has no unit price"
    assert price_data["extension"] == 44_450.0


# ── Case 2: not_awarded only (directional) ───────────────────────────────────


def test_not_awarded_directional():
    vendor = _vendor(
        price_book_entry={
            "awarded": {
                "sample_count": 0,
                "unit_price": {"avg": None, "min": None, "max": None},
                "extension": {"avg": None, "min": None, "max": None},
            },
            "not_awarded": {
                "sample_count": 1,
                "unit_price": {"avg": None, "min": None, "max": None},
                "extension": {"avg": 38_000.0, "min": 38_000.0, "max": 38_000.0},
            },
        }
    )

    price_data, flag = get_price_for_item(vendor, COST_CODE, ITEM_DESC)

    assert flag == "directional"
    assert price_data["source"] == "history"
    assert price_data["extension"] == 38_000.0
    assert "non-awarded" in price_data["note"]


# ── Case 3: legacy pricing_profile only ──────────────────────────────────────


def test_legacy_pricing_profile():
    vendor = _vendor(
        legacy_entry={
            "unit": "LS",
            "extension": {"avg": 41_000.0},
            "description": "HVAC full system lump sum",
        }
    )

    price_data, flag = get_price_for_item(vendor, COST_CODE, ITEM_DESC)

    assert flag == "legacy"
    assert price_data["source"] == "history"
    assert "legacy" in price_data["note"]
    assert price_data["data"]["extension"]["avg"] == 41_000.0


# ── Case 4: no data anywhere ─────────────────────────────────────────────────


def test_no_history():
    vendor: dict = {"name": "New Vendor", "active": True}

    price_data, flag = get_price_for_item(vendor, COST_CODE, ITEM_DESC)

    assert flag == "no_history"
    assert price_data["source"] == "generated"
    assert "unit_price" not in price_data


# ── Edge: item description has no word overlap with history entries ───────────


def test_no_match_falls_through_to_no_history():
    """If description doesn't match any history key, skip all tiers → no_history."""
    vendor = _vendor(
        price_book_entry={
            "awarded": {
                "sample_count": 5,
                "unit_price": {"avg": 100.0, "min": None, "max": None},
                "extension": {"avg": 10_000.0, "min": None, "max": None},
            },
            "not_awarded": {
                "sample_count": 0,
                "unit_price": {"avg": None, "min": None, "max": None},
                "extension": {"avg": None, "min": None, "max": None},
            },
        }
    )
    # Completely unrelated description — no word overlap with "Mechanical system HVAC"
    _, flag = get_price_for_item(vendor, COST_CODE, "xyzzy foo baz qux")
    assert flag == "no_history"
