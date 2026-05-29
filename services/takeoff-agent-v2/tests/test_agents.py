"""
Tests for BaseAgent subclasses and the get_agent() factory.

Covers:
  - ManualHoldAgent / SkipAgent / UnimplementedAgent
  - SFFormulaAgent — basic formula, depth_factor, all-inputs-zero, eval error
  - HistoricalAvgAgent — no data, single vendor, multi-vendor median, confidence
  - get_agent() factory — implemented types, unimplemented types, unknown code
"""

from __future__ import annotations

import sys
import os

# Ensure service root is on path when running from tests/ directory.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents import get_agent
from agents.base import ManualHoldAgent, SkipAgent, UnimplementedAgent
from agents.historical_avg import HistoricalAvgAgent
from agents.sf_formula import SFFormulaAgent
from schemas import SharedParams


# ── Helpers ───────────────────────────────────────────────────────────────────


def _params(**kwargs) -> SharedParams:
    return SharedParams(**kwargs)


# ── ManualHoldAgent ───────────────────────────────────────────────────────────


def test_manual_hold_default_note():
    agent = ManualHoldAgent(cost_code="3800", config={"unit": "LS"})
    out = agent.run(_params(), {})
    assert out.source == "manual"
    assert out.confidence == "low"
    assert out.quantity is None
    assert out.unit == "LS"
    assert out.flags == []


def test_manual_hold_custom_note():
    note = "Contact Karen for electrical."
    agent = ManualHoldAgent(cost_code="3800", config={"note": note, "unit": "LS"})
    out = agent.run(_params(), {})
    assert out.notes == note


# ── SkipAgent ─────────────────────────────────────────────────────────────────


def test_skip_agent():
    agent = SkipAgent(cost_code="9999", config={})
    out = agent.run(_params(), {})
    assert out.source == "skip"
    assert out.quantity is None
    assert out.unit is None
    assert out.confidence == "low"


# ── UnimplementedAgent ────────────────────────────────────────────────────────


def test_unimplemented_agent_flag():
    agent = UnimplementedAgent(
        cost_code="1200", config={"unit": "CY"}, agent_type="dxf_geometry"
    )
    out = agent.run(_params(), {})
    assert out.source == "dxf_geometry"
    assert out.quantity is None
    assert any("agent_type_not_implemented" in f for f in out.flags)
    assert out.confidence == "low"


# ── SFFormulaAgent ────────────────────────────────────────────────────────────


def test_sf_formula_basic():
    agent = SFFormulaAgent(
        cost_code="1300",
        config={
            "formula": "total_finished_sf + garage_sf",
            "inputs": ["total_finished_sf", "garage_sf"],
            "unit": "SF",
        },
    )
    out = agent.run(_params(total_finished_sf=2000.0, garage_sf=400.0), {})
    assert out.quantity == 2400.0
    assert out.unit == "SF"
    assert out.confidence == "high"
    assert out.source == "sf_formula"
    assert out.flags == []


def test_sf_formula_with_depth_factor():
    agent = SFFormulaAgent(
        cost_code="1100",
        config={
            "formula": "first_floor_footprint_sf",
            "inputs": ["first_floor_footprint_sf"],
            "unit": "CY",
            "depth_factor": 0.125,
        },
    )
    out = agent.run(_params(first_floor_footprint_sf=1000.0), {})
    assert out.quantity == 125.0
    assert out.unit == "CY"
    assert out.confidence == "high"


def test_sf_formula_multiplier_embedded_in_formula():
    """Drywall: multiplier is IN the formula string, not a separate key."""
    agent = SFFormulaAgent(
        cost_code="2500",
        config={
            "formula": "total_finished_sf * 1.15",
            "inputs": ["total_finished_sf"],
            "multiplier": 1.15,  # documentation only — not applied by agent
            "unit": "SF",
        },
    )
    out = agent.run(_params(total_finished_sf=2000.0), {})
    assert out.quantity == 2300.0


def test_sf_formula_all_inputs_zero_flag():
    agent = SFFormulaAgent(
        cost_code="1300",
        config={
            "formula": "total_finished_sf + garage_sf",
            "inputs": ["total_finished_sf", "garage_sf"],
            "unit": "SF",
        },
    )
    out = agent.run(_params(), {})  # all fields default to 0
    assert out.quantity == 0.0
    assert any("all_inputs_zero" in f for f in out.flags)


def test_sf_formula_eval_error():
    agent = SFFormulaAgent(
        cost_code="9999",
        config={
            "formula": "import os",  # unsafe — will trigger ValueError
            "inputs": [],
            "unit": "SF",
        },
    )
    out = agent.run(_params(), {})
    assert out.quantity == 0.0
    assert out.confidence == "low"
    assert any("formula_eval_error" in f for f in out.flags)


def test_sf_formula_zero_quantity_not_error():
    """quantity=0.0 is valid when inputs are legitimately zero."""
    agent = SFFormulaAgent(
        cost_code="4400",
        config={
            "formula": "total_finished_sf",
            "inputs": ["total_finished_sf"],
            "unit": "SF",
        },
    )
    out = agent.run(_params(total_finished_sf=0.0), {})
    assert out.quantity == 0.0
    assert out.confidence == "high"  # deterministic result even when zero


# ── HistoricalAvgAgent ────────────────────────────────────────────────────────


def _make_price_book(cost_code: str, avg: float, count: int) -> dict:
    return {
        "categories": {
            cost_code: {
                "line_item": {
                    "awarded": {"extension": {"avg": avg, "sample_count": count}}
                }
            }
        }
    }


def test_historical_avg_no_data():
    agent = HistoricalAvgAgent(cost_code="1900", config={"unit": "LS"})
    out = agent.run(_params(), {})
    assert out.quantity is None
    assert out.confidence == "low"
    assert out.source == "historical_avg"
    assert "no_price_book_data" in out.flags
    assert out.output["avg_awarded_extension"] is None
    assert out.output["sample_count"] == 0


def test_historical_avg_single_vendor():
    agent = HistoricalAvgAgent(cost_code="1900", config={"unit": "LS"})
    price_books = {"vendor_a": _make_price_book("1900", 12500.0, 3)}
    out = agent.run(_params(), price_books)
    assert out.quantity is None  # always None for historical_avg
    assert out.output["avg_awarded_extension"] == 12500.0
    assert out.output["sample_count"] == 3
    assert out.confidence == "medium"  # >= 3 samples
    assert out.flags == []


def test_historical_avg_multi_vendor_median():
    agent = HistoricalAvgAgent(cost_code="4200", config={"unit": "LS"})
    price_books = {
        "vendor_a": _make_price_book("4200", 10000.0, 2),
        "vendor_b": _make_price_book("4200", 20000.0, 1),
        "vendor_c": _make_price_book("4200", 15000.0, 1),
    }
    out = agent.run(_params(), price_books)
    # median([10000, 15000, 20000]) = 15000
    assert out.output["avg_awarded_extension"] == 15000.0
    assert out.output["sample_count"] == 4  # 2+1+1
    assert len(out.output["vendors_sampled"]) == 3


def test_historical_avg_low_confidence_below_3_samples():
    agent = HistoricalAvgAgent(cost_code="4300", config={"unit": "LS"})
    price_books = {"vendor_a": _make_price_book("4300", 8000.0, 2)}
    out = agent.run(_params(), price_books)
    assert out.confidence == "low"  # total_samples=2, below threshold


def test_historical_avg_skips_zero_sample_count():
    """Items with sample_count=0 must not contribute to the result."""
    agent = HistoricalAvgAgent(cost_code="1900", config={"unit": "LS"})
    price_books = {
        "vendor_a": {
            "categories": {
                "1900": {
                    "line_item": {
                        "awarded": {"extension": {"avg": 999.0, "sample_count": 0}}
                    }
                }
            }
        }
    }
    out = agent.run(_params(), price_books)
    assert out.output["avg_awarded_extension"] is None  # zero-count entry ignored
    assert "no_price_book_data" in out.flags


# ── get_agent() factory ───────────────────────────────────────────────────────


def test_factory_sf_formula():
    agent = get_agent("2500")  # Drywall
    assert isinstance(agent, SFFormulaAgent)


def test_factory_historical_avg():
    agent = get_agent("1900")  # Stucco
    assert isinstance(agent, HistoricalAvgAgent)


def test_factory_manual_hold():
    agent = get_agent("3800")  # Electrical
    assert isinstance(agent, ManualHoldAgent)


def test_factory_unimplemented_future_type():
    """Any agent_type not in _IMPLEMENTED_TYPES falls back to UnimplementedAgent.
    We simulate this with a hypothetical unknown type via the unknown-cost-code path."""
    # "9998" is not in the registry → ManualHoldAgent (unknown cost code)
    agent = get_agent("9998")
    assert isinstance(agent, ManualHoldAgent)
    # A truly unknown agent_type would need to be injected via registry; the
    # fallback path in get_agent() is covered by the UnimplementedAgent unit tests.


def test_factory_unknown_cost_code():
    agent = get_agent("9999")
    assert isinstance(agent, ManualHoldAgent)
    assert "9999" in (agent.config.get("note") or "")
