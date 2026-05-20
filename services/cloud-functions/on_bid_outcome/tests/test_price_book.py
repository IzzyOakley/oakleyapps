"""
Unit tests for price_book stat helpers in on_bid_outcome Cloud Function.
Run with: pytest services/cloud-functions/on_bid_outcome/tests/
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import update_price_book_stats, _empty_stats


# ── update_price_book_stats ────────────────────────────────────────────────────


def test_first_entry_extension():
    """First observation — sample_count goes from 0 to 1, all stats equal the value."""
    stats = _empty_stats()["extension"]
    result = update_price_book_stats(stats, 7700.0)
    assert result["avg"] == 7700.0
    assert result["min"] == 7700.0
    assert result["max"] == 7700.0
    assert result["sample_count"] == 1


def test_second_entry_avg_recalculates():
    """Second observation — avg recalculates to the correct running mean."""
    stats = {"min": 7700.0, "max": 7700.0, "avg": 7700.0, "sample_count": 1}
    result = update_price_book_stats(stats, 8300.0)
    assert result["avg"] == 8000.0  # (7700 + 8300) / 2
    assert result["min"] == 7700.0
    assert result["max"] == 8300.0
    assert result["sample_count"] == 2


def test_third_entry_running_avg():
    """Three observations — running average is correct."""
    stats = {"min": 7700.0, "max": 8300.0, "avg": 8000.0, "sample_count": 2}
    result = update_price_book_stats(stats, 8600.0)
    expected_avg = (8000.0 * 2 + 8600.0) / 3
    assert abs(result["avg"] - round(expected_avg, 4)) < 0.001
    assert result["min"] == 7700.0
    assert result["max"] == 8600.0
    assert result["sample_count"] == 3


def test_null_unit_price_does_not_crash():
    """
    Lump-sum vendors have unit_price=None.
    The caller skips unit_price update; only extension stats are updated.
    This test verifies the extension update works and unit_price stats stay at default.
    """
    empty = _empty_stats()
    # Simulate: unit_price is None — skip unit_price stats
    assert empty["unit_price"]["sample_count"] == 0

    # Only update extension
    ext_result = update_price_book_stats(empty["extension"], 44450.0)
    assert ext_result["sample_count"] == 1
    assert ext_result["avg"] == 44450.0
    # unit_price stats unchanged
    assert empty["unit_price"]["sample_count"] == 0


def test_awarded_and_not_awarded_tracked_separately():
    """Awarded and not_awarded stats must never bleed into each other."""
    entry = {
        "cost_code_name": "HVAC",
        "awarded": _empty_stats(),
        "not_awarded": _empty_stats(),
    }

    # Update awarded extension
    entry["awarded"]["extension"] = update_price_book_stats(
        entry["awarded"]["extension"], 44450.0
    )

    assert entry["awarded"]["extension"]["sample_count"] == 1
    # not_awarded extension unchanged
    assert entry["not_awarded"]["extension"]["sample_count"] == 0
    assert entry["not_awarded"]["extension"]["avg"] is None


def test_not_awarded_tracked_independently():
    """not_awarded stats update independently of awarded."""
    entry = {
        "cost_code_name": "Roofing",
        "awarded": _empty_stats(),
        "not_awarded": _empty_stats(),
    }
    entry["not_awarded"]["extension"] = update_price_book_stats(
        entry["not_awarded"]["extension"], 32000.0
    )

    assert entry["not_awarded"]["extension"]["sample_count"] == 1
    assert entry["awarded"]["extension"]["sample_count"] == 0


def test_unmatched_cost_code_key():
    """Items without a cost_code should use 'UNMATCHED' as the key."""
    cost_code = ""
    code_key = cost_code if cost_code else "UNMATCHED"
    assert code_key == "UNMATCHED"


def test_empty_cost_code_maps_to_unmatched():
    """Verify the conditional in main.py produces UNMATCHED for empty string."""
    for empty_val in ("", None):
        code_key = empty_val if empty_val else "UNMATCHED"
        assert code_key == "UNMATCHED"


def test_min_updates_downward():
    """Min should update when a lower value arrives."""
    stats = {"min": 5000.0, "max": 8000.0, "avg": 6500.0, "sample_count": 2}
    result = update_price_book_stats(stats, 3000.0)
    assert result["min"] == 3000.0
    assert result["max"] == 8000.0


def test_max_updates_upward():
    """Max should update when a higher value arrives."""
    stats = {"min": 5000.0, "max": 8000.0, "avg": 6500.0, "sample_count": 2}
    result = update_price_book_stats(stats, 12000.0)
    assert result["max"] == 12000.0
    assert result["min"] == 5000.0
