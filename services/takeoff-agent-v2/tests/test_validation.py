"""
Tests for ValidationAgent (Phase 13.2).

Covers:
  _pb_avg_extension helper
    - returns None when no price book data for code
    - returns correct average across vendors
    - sums item extensions per vendor before averaging

  _analyze_items
    - computes implied_unit_cost correctly
    - flags items where abs(variance_pct) > 20%
    - does not flag items within threshold
    - missing price book → variance_pct = None, flagged = False

  ValidationAgent.run
    - builds report with correct summary_stats
    - calls Claude with analysis payload
    - returns claude_summary in report
    - handles missing ANTHROPIC_API_KEY gracefully (no summary, status=claude_api_error)
    - handles Claude API error gracefully (no summary, status contains error)
    - works with empty price_book_data (validation_status=no_price_book_data)
    - works with empty cost_code_docs (no errors)
    - skipped / manual_required codes counted correctly in stats
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents.validation import ValidationAgent, _analyze_items, _pb_avg_extension


# ── Price-book helper ─────────────────────────────────────────────────────────


def _make_pb(cost_code: str, extensions: list[float]) -> dict:
    """Build a minimal price_book dict with given extensions for one cost code."""
    items = {}
    for i, ext in enumerate(extensions):
        items[f"Item {i}"] = {"awarded": {"extension": {"avg": ext, "sample_count": 3}}}
    return {"categories": {cost_code: items}}


def test_pb_avg_extension_no_data():
    assert _pb_avg_extension("2000", {}) is None


def test_pb_avg_extension_no_code_in_book():
    pb = {"v1": _make_pb("9999", [1000.0])}
    assert _pb_avg_extension("2000", pb) is None


def test_pb_avg_extension_single_vendor():
    pb = {"v1": _make_pb("2000", [10000.0, 5000.0])}
    result = _pb_avg_extension("2000", pb)
    # 10000 + 5000 = 15000 from v1; only one vendor → avg = 15000
    assert result == pytest.approx(15000.0)


def test_pb_avg_extension_multiple_vendors():
    # v1 has total 10000, v2 has total 20000 → avg = 15000
    pb = {
        "v1": _make_pb("2000", [10000.0]),
        "v2": _make_pb("2000", [20000.0]),
    }
    result = _pb_avg_extension("2000", pb)
    assert result == pytest.approx(15000.0)


def test_pb_avg_extension_sums_items_before_averaging():
    # v1 has 2 items: 4000 + 6000 = 10000
    # v2 has 1 item: 20000
    # avg = (10000 + 20000) / 2 = 15000
    pb = {
        "v1": _make_pb("2000", [4000.0, 6000.0]),
        "v2": _make_pb("2000", [20000.0]),
    }
    result = _pb_avg_extension("2000", pb)
    assert result == pytest.approx(15000.0)


# ── Item analysis ─────────────────────────────────────────────────────────────


def _cc_doc(
    code: str,
    status: str = "complete",
    quantity: float | None = 10.0,
    estimate_cost: float | None = 10000.0,
) -> dict:
    return {
        "cost_code": code,
        "cost_code_name": f"Code {code}",
        "agent_status": status,
        "quantity": quantity,
        "unit": "EA",
        "estimate_final_cost": estimate_cost,
    }


def test_analyze_items_implied_unit_cost():
    items = _analyze_items([_cc_doc("2000", quantity=10.0, estimate_cost=20000.0)], {})
    assert items[0]["implied_unit_cost"] == pytest.approx(2000.0)


def test_analyze_items_no_quantity_no_implied():
    items = _analyze_items([_cc_doc("2000", quantity=None)], {})
    assert items[0]["implied_unit_cost"] is None


def test_analyze_items_flags_high_variance():
    # pb_avg = 10000, estimate = 13000 → +30% → flagged
    pb = {"v1": _make_pb("2000", [10000.0])}
    items = _analyze_items([_cc_doc("2000", estimate_cost=13000.0)], pb)
    assert items[0]["flagged"] is True
    assert items[0]["variance_pct"] == pytest.approx(30.0)


def test_analyze_items_does_not_flag_within_threshold():
    # pb_avg = 10000, estimate = 11500 → +15% → not flagged
    pb = {"v1": _make_pb("2000", [10000.0])}
    items = _analyze_items([_cc_doc("2000", estimate_cost=11500.0)], pb)
    assert items[0]["flagged"] is False


def test_analyze_items_negative_variance_flags():
    # pb_avg = 10000, estimate = 6000 → -40% → flagged
    pb = {"v1": _make_pb("2000", [10000.0])}
    items = _analyze_items([_cc_doc("2000", estimate_cost=6000.0)], pb)
    assert items[0]["flagged"] is True
    assert items[0]["variance_pct"] == pytest.approx(-40.0)


def test_analyze_items_no_price_book_not_flagged():
    items = _analyze_items([_cc_doc("2000")], {})
    assert items[0]["variance_pct"] is None
    assert items[0]["flagged"] is False
    assert items[0]["pb_avg_extension"] is None


# ── ValidationAgent.run ───────────────────────────────────────────────────────


_COST_CODE_DOCS = [
    _cc_doc("2000", "complete", 24.0, 48000.0),
    _cc_doc("2500", "complete", 2300.0, 9200.0),
    _cc_doc("3800", "manual_required", None, None),
    _cc_doc("4800", "skipped", None, None),
    _cc_doc("1200", "failed", None, None),
]

_PRICE_BOOK = {"v1": _make_pb("2000", [45000.0]), "v1b": _make_pb("2500", [9000.0])}


def _mock_claude_response(text: str = "All looks good. Ready to approve."):
    mock_resp = MagicMock()
    mock_resp.content = [MagicMock(text=text)]
    mock_resp.usage.input_tokens = 500
    mock_resp.usage.output_tokens = 80
    return mock_resp


def test_validation_builds_summary_stats():
    with (
        patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}),
        patch("anthropic.Anthropic") as mock_cls,
    ):
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = _mock_claude_response()

        report = ValidationAgent().run(
            "proj1", "Test House", _COST_CODE_DOCS, _PRICE_BOOK
        )

    stats = report["summary_stats"]
    assert stats["total_codes"] == 5
    assert stats["complete"] == 2
    assert stats["manual_required"] == 1
    assert stats["skipped"] == 1
    assert stats["failed"] == 1


def test_validation_flagged_count_in_stats():
    # 2000: estimate=48000, pb_avg=45000 → +6.7% → not flagged
    # 2500: estimate=9200, pb_avg=9000 → +2.2% → not flagged
    with (
        patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}),
        patch("anthropic.Anthropic") as mock_cls,
    ):
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = _mock_claude_response()

        report = ValidationAgent().run(
            "proj1", "Test House", _COST_CODE_DOCS, _PRICE_BOOK
        )

    assert report["summary_stats"]["flagged"] == 0


def test_validation_flagged_item_in_items():
    # Make 2000 have 50% variance
    docs = [_cc_doc("2000", "complete", 10.0, 67500.0)]  # 35% over pb_avg=50000
    pb = {"v1": _make_pb("2000", [50000.0])}
    with (
        patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}),
        patch("anthropic.Anthropic") as mock_cls,
    ):
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = _mock_claude_response()
        report = ValidationAgent().run("proj1", "House", docs, pb)

    flagged = [it for it in report["items"] if it["flagged"]]
    assert len(flagged) == 1
    assert flagged[0]["cost_code"] == "2000"


def test_validation_no_api_key_returns_report_without_summary():
    with patch.dict(os.environ, {"ANTHROPIC_API_KEY": ""}):
        report = ValidationAgent().run(
            "proj1", "Test House", _COST_CODE_DOCS, _PRICE_BOOK
        )

    assert report["claude_summary"] is None
    assert report["validation_status"] == "claude_api_error"
    assert report["input_tokens"] is None
    assert len(report["items"]) == 5  # items still computed


def test_validation_claude_api_error_nonfatal():
    with (
        patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}),
        patch("anthropic.Anthropic") as mock_cls,
    ):
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = RuntimeError("timeout")

        report = ValidationAgent().run(
            "proj1", "Test House", _COST_CODE_DOCS, _PRICE_BOOK
        )

    assert report["claude_summary"] is None
    assert "claude_api_error" in report["validation_status"]
    # items and stats still present
    assert report["summary_stats"]["total_codes"] == 5


def test_validation_empty_price_book_status():
    with (
        patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}),
        patch("anthropic.Anthropic") as mock_cls,
    ):
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = _mock_claude_response()

        report = ValidationAgent().run(
            "proj1", "Test House", _COST_CODE_DOCS, {}
        )

    assert report["validation_status"] == "no_price_book_data"


def test_validation_empty_docs_no_error():
    with (
        patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}),
        patch("anthropic.Anthropic") as mock_cls,
    ):
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.return_value = _mock_claude_response()

        report = ValidationAgent().run("proj1", "Empty House", [], {})

    assert report["summary_stats"]["total_codes"] == 0
    assert report["items"] == []


def test_validation_claude_called_with_project_info():
    """Claude receives project_id and job_name in the payload."""
    payloads_sent: list[str] = []

    def _capture_call(*args, **kwargs):
        messages = kwargs.get("messages", [])
        if messages:
            payloads_sent.append(messages[0]["content"])
        return _mock_claude_response()

    with (
        patch.dict(os.environ, {"ANTHROPIC_API_KEY": "test-key"}),
        patch("anthropic.Anthropic") as mock_cls,
    ):
        mock_client = MagicMock()
        mock_cls.return_value = mock_client
        mock_client.messages.create.side_effect = _capture_call

        ValidationAgent().run(
            "my_project", "Grand Avenue House", _COST_CODE_DOCS, _PRICE_BOOK
        )

    assert payloads_sent, "Claude was not called"
    assert "my_project" in payloads_sent[0]
    assert "Grand Avenue House" in payloads_sent[0]
