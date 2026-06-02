"""
Tests for DXFGeometryAgent (Phase 12).

Real ezdxf documents are built in memory and saved to temp files so the
agent exercises the actual ezdxf read path.  No mocking of ezdxf internals.

Covers:
  perimeter geometry (Foundation 1200)
    - correct perimeter and volume_cy from a square polygon
    - default_depth_ft_used and default_thickness_ft_used flags
    - configurable depth_ft / thickness_ft suppress default flags
    - no_dxf_path returns low confidence
    - bad file path returns low confidence

  roof_area geometry (Roofing 1600)
    - correct SQ from footprint area × pitch factor
    - pitch parsed from TEXT entity (no default flag)
    - default_pitch_used flag when no TEXT annotation found
    - eave_lf equals perimeter of roof polygon
    - no_dxf_path returns low confidence

  wall_area geometry (Siding 1700)
    - gross_wall_sf correct, openings_sf=0 with no_opening_layers_configured
    - opening_layers deducted from gross area

  eave_perimeter geometry (Gutters 3500)
    - eave_perimeter_lf correct
    - by_side_requires_calibration always flagged

  Factory
    - get_agent("1200") → DXFGeometryAgent
    - get_agent("1600") → DXFGeometryAgent
    - get_agent("1700") → DXFGeometryAgent
    - get_agent("3500") → DXFGeometryAgent
"""

from __future__ import annotations

import math
import os
import sys
import tempfile

import ezdxf
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents import get_agent
from agents.dxf_geometry import DXFGeometryAgent, _pitch_factor
from schemas import SharedParams


# ── DXF helpers ──────────────────────────────────────────────────────────────


def _write_temp(doc) -> str:
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="w") as f:
        path = f.name
    doc.saveas(path)
    return path


def _dxf_with_polyline(
    layer: str,
    pts: list[tuple[float, float]],
    insunits: int = 2,  # 2 = feet
    closed: bool = True,
    text_entities: list[tuple[str, str]] | None = None,  # [(layer, text), ...]
) -> str:
    """Write a temp DXF with one LWPOLYLINE and optional TEXT entities."""
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = insunits
    msp = doc.modelspace()
    if not doc.layers.has_entry(layer):
        doc.layers.add(layer)
    lw = msp.add_lwpolyline(pts, close=closed)
    lw.dxf.layer = layer
    if text_entities:
        for txt_layer, txt_val in text_entities:
            if not doc.layers.has_entry(txt_layer):
                doc.layers.add(txt_layer)
            te = msp.add_text(txt_val)
            te.dxf.layer = txt_layer
    return _write_temp(doc)


def _params(**kwargs) -> SharedParams:
    return SharedParams(**kwargs)


def _sq(pts: list[tuple[float, float]]) -> float:
    """Shoelace area for a simple polygon (no holes)."""
    n = len(pts)
    s = sum(
        pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1]
        for i in range(n)
    )
    return abs(s) / 2.0


def _perim(pts: list[tuple[float, float]]) -> float:
    """Perimeter of a closed polygon."""
    n = len(pts)
    return sum(
        math.sqrt(
            (pts[(i + 1) % n][0] - pts[i][0]) ** 2
            + (pts[(i + 1) % n][1] - pts[i][1]) ** 2
        )
        for i in range(n)
    )


# ── perimeter geometry ────────────────────────────────────────────────────────


class TestPerimeterGeometry:
    _LAYER = "A-WALL-FNDN"
    # 10×20 rectangle in feet (insunits=2)
    _RECT = [(0, 0), (10, 0), (10, 20), (0, 20)]

    def _agent(self, **extra) -> DXFGeometryAgent:
        config = {
            "geometry_type": "perimeter",
            "target_layers": [self._LAYER],
            "unit": "CY",
            **extra,
        }
        return DXFGeometryAgent(cost_code="1200", config=config)

    def test_correct_perimeter_and_volume(self):
        path = _dxf_with_polyline(self._LAYER, self._RECT)
        try:
            out = self._agent(depth_ft=8.0, thickness_ft=0.833).run(
                _params(), {}, dxf_local_path=path
            )
        finally:
            os.unlink(path)

        expected_perimeter = _perim(self._RECT)  # 60.0 LF
        expected_cy = round(expected_perimeter * 8.0 * 0.833 / 27.0, 2)

        assert out.source == "dxf_geometry"
        assert out.confidence == "medium"
        assert out.output["perimeter_lf"] == pytest.approx(expected_perimeter, rel=1e-3)
        assert out.output["volume_cy"] == pytest.approx(expected_cy, rel=1e-3)
        assert out.quantity == pytest.approx(expected_cy, rel=1e-3)
        assert out.unit == "CY"
        assert out.flags == []

    def test_default_flags_when_dims_not_configured(self):
        path = _dxf_with_polyline(self._LAYER, self._RECT)
        try:
            out = self._agent().run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert "default_depth_ft_used:8.0" in out.flags
        assert "default_thickness_ft_used:0.833" in out.flags

    def test_no_default_flags_when_dims_configured(self):
        path = _dxf_with_polyline(self._LAYER, self._RECT)
        try:
            out = self._agent(depth_ft=7.0, thickness_ft=1.0).run(
                _params(), {}, dxf_local_path=path
            )
        finally:
            os.unlink(path)

        assert not any("default_depth_ft" in f for f in out.flags)
        assert not any("default_thickness_ft" in f for f in out.flags)

    def test_no_dxf_path_returns_low_confidence(self):
        out = self._agent().run(_params(), {}, dxf_local_path=None)
        assert out.confidence == "low"
        assert "no_dxf_path" in out.flags
        assert out.quantity is None

    def test_bad_path_returns_low_confidence(self):
        out = self._agent().run(_params(), {}, dxf_local_path="/nonexistent/file.dxf")
        assert out.confidence == "low"
        assert any("dxf_read_error" in f for f in out.flags)


# ── roof_area geometry ────────────────────────────────────────────────────────


class TestRoofAreaGeometry:
    _LAYER = "A-ROOF"
    # 20×30 rectangle in feet (area = 600 SF)
    _RECT = [(0, 0), (20, 0), (20, 30), (0, 30)]

    def _agent(self, **extra) -> DXFGeometryAgent:
        config = {
            "geometry_type": "roof_area",
            "target_layers": [self._LAYER],
            "default_pitch": "8/12",
            "unit": "SQ",
            **extra,
        }
        return DXFGeometryAgent(cost_code="1600", config=config)

    def test_correct_sq_from_footprint(self):
        path = _dxf_with_polyline(self._LAYER, self._RECT)
        try:
            out = self._agent().run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        footprint_sf = _sq(self._RECT)  # 600 SF
        factor = _pitch_factor("8/12")
        expected_roof_sf = footprint_sf * factor
        expected_sq = round(expected_roof_sf / 100.0, 2)

        assert out.source == "dxf_geometry"
        assert out.confidence == "medium"
        assert out.quantity == pytest.approx(expected_sq, rel=1e-3)
        assert out.unit == "SQ"
        assert out.output["total_roof_sf"] == pytest.approx(expected_roof_sf, rel=1e-3)
        # default pitch flag because no TEXT entities
        assert "default_pitch_used:8/12" in out.flags

    def test_eave_lf_equals_perimeter(self):
        path = _dxf_with_polyline(self._LAYER, self._RECT)
        try:
            out = self._agent().run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        expected_eave_lf = _perim(self._RECT)  # 100.0 LF
        assert out.output["eave_lf"] == pytest.approx(expected_eave_lf, rel=1e-3)

    def test_pitch_parsed_from_text_entity(self):
        path = _dxf_with_polyline(
            self._LAYER, self._RECT, text_entities=[("A-TEXT", "ROOF PITCH 10/12")]
        )
        try:
            out = self._agent().run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.output["pitch"] == "10/12"
        # No default flag — pitch was found in DXF
        assert not any("default_pitch_used" in f for f in out.flags)
        factor = _pitch_factor("10/12")
        expected_sq = round(_sq(self._RECT) * factor / 100.0, 2)
        assert out.quantity == pytest.approx(expected_sq, rel=1e-3)

    def test_default_pitch_used_flag_when_no_text(self):
        path = _dxf_with_polyline(self._LAYER, self._RECT)
        try:
            out = self._agent(default_pitch="6/12").run(
                _params(), {}, dxf_local_path=path
            )
        finally:
            os.unlink(path)

        assert "default_pitch_used:6/12" in out.flags
        assert out.output["pitch"] == "6/12"

    def test_no_dxf_path_returns_low_confidence(self):
        out = self._agent().run(_params(), {}, dxf_local_path=None)
        assert out.confidence == "low"
        assert "no_dxf_path" in out.flags


# ── wall_area geometry ────────────────────────────────────────────────────────


class TestWallAreaGeometry:
    _WALL_LAYER = "A-WALL-EXTR"
    _OPENING_LAYER = "A-GLAZ"
    # 40×60 exterior wall polygon (area 2400 SF)
    _WALL_RECT = [(0, 0), (40, 0), (40, 60), (0, 60)]
    # 3×4 window opening (area 12 SF)
    _OPENING_RECT = [(5, 5), (8, 5), (8, 9), (5, 9)]

    def _agent(self, **extra) -> DXFGeometryAgent:
        config = {
            "geometry_type": "wall_area",
            "target_layers": [self._WALL_LAYER],
            "unit": "SF",
            **extra,
        }
        return DXFGeometryAgent(cost_code="1700", config=config)

    def _dxf_with_wall_and_opening(self) -> str:
        doc = ezdxf.new()
        doc.header["$INSUNITS"] = 2
        msp = doc.modelspace()
        for layer in (self._WALL_LAYER, self._OPENING_LAYER):
            if not doc.layers.has_entry(layer):
                doc.layers.add(layer)
        w = msp.add_lwpolyline(self._WALL_RECT, close=True)
        w.dxf.layer = self._WALL_LAYER
        o = msp.add_lwpolyline(self._OPENING_RECT, close=True)
        o.dxf.layer = self._OPENING_LAYER
        return _write_temp(doc)

    def test_gross_wall_sf_no_openings(self):
        path = _dxf_with_polyline(self._WALL_LAYER, self._WALL_RECT)
        try:
            out = self._agent().run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        gross = _sq(self._WALL_RECT)
        assert out.output["gross_wall_sf"] == pytest.approx(gross, rel=1e-3)
        assert out.output["openings_sf"] == 0.0
        assert out.output["net_wall_sf"] == pytest.approx(gross, rel=1e-3)
        assert out.quantity == pytest.approx(gross, rel=1e-3)
        assert "no_opening_layers_configured" in out.flags

    def test_openings_deducted_from_gross(self):
        path = self._dxf_with_wall_and_opening()
        try:
            out = self._agent(opening_layers=[self._OPENING_LAYER]).run(
                _params(), {}, dxf_local_path=path
            )
        finally:
            os.unlink(path)

        gross = _sq(self._WALL_RECT)
        openings = _sq(self._OPENING_RECT)
        assert out.output["gross_wall_sf"] == pytest.approx(gross, rel=1e-3)
        assert out.output["openings_sf"] == pytest.approx(openings, rel=1e-3)
        assert out.output["net_wall_sf"] == pytest.approx(gross - openings, rel=1e-3)
        assert "no_opening_layers_configured" not in out.flags

    def test_no_dxf_path_returns_low_confidence(self):
        out = self._agent().run(_params(), {}, dxf_local_path=None)
        assert out.confidence == "low"
        assert "no_dxf_path" in out.flags


# ── eave_perimeter geometry ───────────────────────────────────────────────────


class TestEavePerimeterGeometry:
    _LAYER = "A-ROOF-OTLN"
    # L-shaped polygon: 8 pts, total perimeter calculable
    _POLY = [(0, 0), (30, 0), (30, 10), (20, 10), (20, 20), (0, 20)]

    def _agent(self) -> DXFGeometryAgent:
        return DXFGeometryAgent(
            cost_code="3500",
            config={
                "geometry_type": "eave_perimeter",
                "target_layers": [self._LAYER],
                "unit": "LF",
            },
        )

    def test_correct_eave_perimeter_lf(self):
        path = _dxf_with_polyline(self._LAYER, self._POLY)
        try:
            out = self._agent().run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        expected_lf = _perim(self._POLY)
        assert out.source == "dxf_geometry"
        assert out.confidence == "medium"
        assert out.quantity == pytest.approx(expected_lf, rel=1e-3)
        assert out.output["eave_perimeter_lf"] == pytest.approx(expected_lf, rel=1e-3)
        assert out.output["by_side"] == []
        assert out.unit == "LF"

    def test_by_side_requires_calibration_always_flagged(self):
        path = _dxf_with_polyline(self._LAYER, self._POLY)
        try:
            out = self._agent().run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert "by_side_requires_calibration" in out.flags

    def test_no_dxf_path_returns_low_confidence(self):
        out = self._agent().run(_params(), {}, dxf_local_path=None)
        assert out.confidence == "low"
        assert "no_dxf_path" in out.flags

    def test_bad_path_returns_low_confidence(self):
        out = self._agent().run(_params(), {}, dxf_local_path="/nonexistent/file.dxf")
        assert out.confidence == "low"
        assert any("dxf_read_error" in f for f in out.flags)


# ── pitch helpers ─────────────────────────────────────────────────────────────


def test_pitch_factor_8_12():
    assert _pitch_factor("8/12") == pytest.approx(
        math.sqrt(1 + (8 / 12) ** 2), rel=1e-6
    )


def test_pitch_factor_10_12():
    assert _pitch_factor("10/12") == pytest.approx(
        math.sqrt(1 + (10 / 12) ** 2), rel=1e-6
    )


# ── Factory ───────────────────────────────────────────────────────────────────


def test_factory_foundation_now_historical_avg():
    # 1200 Foundation switched to historical_avg — walls are LINE entities,
    # not LWPOLYLINE, so dxf_geometry perimeter cannot be measured.
    from agents.historical_avg import HistoricalAvgAgent

    agent = get_agent("1200")
    assert isinstance(agent, HistoricalAvgAgent)


def test_factory_roofing_geometry():
    agent = get_agent("1600")
    assert isinstance(agent, DXFGeometryAgent)
    assert agent.config["geometry_type"] == "roof_area"


def test_factory_siding_now_historical_avg():
    # 1700 Siding switched to historical_avg — no closed LWPOLY in elevation DXFs.
    from agents.historical_avg import HistoricalAvgAgent

    agent = get_agent("1700")
    assert isinstance(agent, HistoricalAvgAgent)


def test_factory_gutters_geometry():
    agent = get_agent("3500")
    assert isinstance(agent, DXFGeometryAgent)
    assert agent.config["geometry_type"] == "eave_perimeter"
