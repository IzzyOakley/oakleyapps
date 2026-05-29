"""
Tests for DXFCountAgent and DXFAreaAgent (Phase 11).

Real ezdxf documents are built in memory and saved to temp files so the agents
exercise the actual ezdxf read path.  No mocking of ezdxf internals.

Covers:
  DXFCountAgent
    - counts INSERTs matching layer + pattern
    - layer filter: entity on wrong layer not counted
    - pattern filter: block name not matching pattern not counted
    - empty modelspace returns quantity=0, not error
    - no_dxf_path when dxf_local_path=None
    - bad file path returns low confidence + flag

  DXFAreaAgent
    - sums LWPOLYLINE areas on target layer
    - filters polygons below min_area_sf
    - no entities on target layer returns quantity=0
    - unit conversion: inches → SF
    - carpet: unit=SY → quantity = total_sf / 9
    - no_dxf_path when dxf_local_path=None
    - bad file path returns low confidence + flag

  Factory (get_agent)
    - dxf_count codes return DXFCountAgent (Phase 11 now implemented)
    - dxf_area codes return DXFAreaAgent (Phase 11 now implemented)
    - dxf_geometry still returns UnimplementedAgent (Phase 12)

  run endpoint (dxf_required_but_not_present)
    - 200 with agent_status=failed when project has no DXF
"""

from __future__ import annotations

import os
import sys
import tempfile
from unittest.mock import patch

import ezdxf
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents import get_agent
from agents.dxf_area import DXFAreaAgent
from agents.dxf_count import DXFCountAgent
from schemas import SharedParams


# ── DXF file factories ────────────────────────────────────────────────────────


def _dxf_with_inserts(
    inserts: list[tuple[str, str]],  # [(block_name, layer), ...]
    insunits: int = 2,  # 2 = feet
) -> str:
    """Write a temp DXF with INSERT entities. Returns temp file path."""
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = insunits
    msp = doc.modelspace()
    _created_blocks: set[str] = set()
    for block_name, layer in inserts:
        if block_name not in _created_blocks:
            doc.blocks.new(name=block_name)
            _created_blocks.add(block_name)
        if not doc.layers.has_entry(layer):
            doc.layers.add(layer)
        ref = msp.add_blockref(block_name, (0, 0))
        ref.dxf.layer = layer
    path = _write_temp(doc)
    return path


def _dxf_with_polylines(
    polygons: list[tuple[str, list[tuple[float, float]]]],  # [(layer, points), ...]
    insunits: int = 2,
) -> str:
    """Write a temp DXF with closed LWPOLYLINE entities. Returns temp file path."""
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = insunits
    msp = doc.modelspace()
    for layer, pts in polygons:
        if not doc.layers.has_entry(layer):
            doc.layers.add(layer)
        lw = msp.add_lwpolyline(pts, close=True)
        lw.dxf.layer = layer
    return _write_temp(doc)


def _dxf_empty(insunits: int = 2) -> str:
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = insunits
    return _write_temp(doc)


def _write_temp(doc) -> str:
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="w") as f:
        path = f.name
    doc.saveas(path)
    return path


def _params(**kwargs) -> SharedParams:
    return SharedParams(**kwargs)


# ── DXFCountAgent ─────────────────────────────────────────────────────────────


class TestDXFCountAgent:
    def test_counts_matching_inserts(self):
        path = _dxf_with_inserts(
            [("WINDOW_A", "A-WIND"), ("WINDOW_B", "A-WIND"), ("DOOR_UNIT", "A-DOOR")]
        )
        try:
            agent = DXFCountAgent(
                cost_code="2000",
                config={
                    "target_layers": ["A-WIND"],
                    "block_name_patterns": ["WIN"],
                    "unit": "EA",
                },
            )
            out = agent.run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == 2.0
        assert out.unit == "EA"
        assert out.source == "dxf_count"
        assert out.confidence == "medium"
        assert out.output["total_count"] == 2
        assert out.flags == []

    def test_layer_filter_excludes_wrong_layer(self):
        path = _dxf_with_inserts([("WINDOW_A", "WRONG_LAYER")])
        try:
            agent = DXFCountAgent(
                cost_code="2000",
                config={
                    "target_layers": ["A-WIND"],
                    "block_name_patterns": ["WIN"],
                    "unit": "EA",
                },
            )
            out = agent.run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == 0.0
        assert out.output["total_count"] == 0

    def test_pattern_filter_excludes_non_matching_block(self):
        path = _dxf_with_inserts([("DOOR_EXT", "A-WIND")])
        try:
            agent = DXFCountAgent(
                cost_code="2000",
                config={
                    "target_layers": ["A-WIND"],
                    "block_name_patterns": ["WIN"],
                    "unit": "EA",
                },
            )
            out = agent.run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == 0.0

    def test_empty_modelspace_returns_zero_not_error(self):
        path = _dxf_empty()
        try:
            agent = DXFCountAgent(
                cost_code="2000",
                config={
                    "target_layers": ["A-WIND"],
                    "block_name_patterns": ["WIN"],
                    "unit": "EA",
                },
            )
            out = agent.run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == 0.0
        assert out.confidence == "medium"  # succeeded — just no matches
        assert out.flags == []

    def test_no_dxf_path_returns_low_confidence(self):
        agent = DXFCountAgent(
            cost_code="2000",
            config={"target_layers": [], "block_name_patterns": [], "unit": "EA"},
        )
        out = agent.run(_params(), {}, dxf_local_path=None)

        assert out.quantity is None
        assert out.confidence == "low"
        assert "no_dxf_path" in out.flags

    def test_bad_file_path_returns_low_confidence(self):
        agent = DXFCountAgent(
            cost_code="2000",
            config={"target_layers": [], "block_name_patterns": [], "unit": "EA"},
        )
        out = agent.run(_params(), {}, dxf_local_path="/no/such/file.dxf")

        assert out.quantity == 0.0
        assert out.confidence == "low"
        assert any("dxf_read_error" in f for f in out.flags)

    def test_multiple_patterns_counted_separately(self):
        """Different patterns accumulate into separate counts_by_type keys."""
        path = _dxf_with_inserts(
            [
                ("TOILET_UNIT", "P-FIXT"),
                ("TOILET_UNIT", "P-FIXT"),
                ("SINK_BASE", "P-FIXT"),
            ]
        )
        try:
            agent = DXFCountAgent(
                cost_code="3600",
                config={
                    "target_layers": ["P-FIXT"],
                    "block_name_patterns": ["TOILET", "SINK"],
                    "unit": "Fix",
                },
            )
            out = agent.run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == 3.0
        assert out.output["counts_by_type"]["TOILET"] == 2
        assert out.output["counts_by_type"]["SINK"] == 1

    def test_no_layer_filter_counts_all_matching_patterns(self):
        """Empty target_layers means accept any layer."""
        path = _dxf_with_inserts([("WIN_A", "LAYER_X"), ("WIN_B", "LAYER_Y")])
        try:
            agent = DXFCountAgent(
                cost_code="2000",
                config={
                    "target_layers": [],
                    "block_name_patterns": ["WIN"],
                    "unit": "EA",
                },
            )
            out = agent.run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == 2.0


# ── DXFAreaAgent ──────────────────────────────────────────────────────────────


class TestDXFAreaAgent:
    def test_sums_lwpolyline_on_target_layer(self):
        # 10×10 ft = 100 SF
        path = _dxf_with_polylines(
            [("A-FINSH-HARD", [(0, 0), (10, 0), (10, 10), (0, 10)])]
        )
        try:
            agent = DXFAreaAgent(
                cost_code="3000",
                config={
                    "target_layers": ["A-FINSH-HARD"],
                    "min_area_sf": 5.0,
                    "unit": "SF",
                },
            )
            out = agent.run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == pytest.approx(100.0, rel=0.01)
        assert out.unit == "SF"
        assert out.source == "dxf_area"
        assert out.confidence == "medium"
        assert out.output["total_sf"] == pytest.approx(100.0, rel=0.01)
        assert len(out.output["rooms"]) == 1
        assert out.flags == []

    def test_filters_polygon_below_min_area(self):
        # 1×1 ft = 1 SF — below min_area_sf=5
        path = _dxf_with_polylines([("A-FINSH-HARD", [(0, 0), (1, 0), (1, 1), (0, 1)])])
        try:
            agent = DXFAreaAgent(
                cost_code="3000",
                config={
                    "target_layers": ["A-FINSH-HARD"],
                    "min_area_sf": 5.0,
                    "unit": "SF",
                },
            )
            out = agent.run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == 0.0
        assert out.output["rooms"] == []

    def test_ignores_entity_on_wrong_layer(self):
        path = _dxf_with_polylines(
            [("WRONG_LAYER", [(0, 0), (20, 0), (20, 20), (0, 20)])]
        )
        try:
            agent = DXFAreaAgent(
                cost_code="3000",
                config={
                    "target_layers": ["A-FINSH-HARD"],
                    "min_area_sf": 5.0,
                    "unit": "SF",
                },
            )
            out = agent.run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == 0.0

    def test_unit_conversion_inches(self):
        # INSUNITS=1 (inches): 120×120 in = 10ft×10ft = 100 SF
        path = _dxf_with_polylines(
            [("A-FINSH-HARD", [(0, 0), (120, 0), (120, 120), (0, 120)])],
            insunits=1,
        )
        try:
            agent = DXFAreaAgent(
                cost_code="3000",
                config={
                    "target_layers": ["A-FINSH-HARD"],
                    "min_area_sf": 5.0,
                    "unit": "SF",
                },
            )
            out = agent.run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == pytest.approx(100.0, rel=0.01)

    def test_carpet_sy_conversion(self):
        # 30×30 ft = 900 SF = 100 SY
        path = _dxf_with_polylines(
            [("A-FINSH-CARP", [(0, 0), (30, 0), (30, 30), (0, 30)])]
        )
        try:
            agent = DXFAreaAgent(
                cost_code="3300",
                config={
                    "target_layers": ["A-FINSH-CARP"],
                    "min_area_sf": 5.0,
                    "unit": "SY",
                },
            )
            out = agent.run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.unit == "SY"
        assert out.quantity == pytest.approx(100.0, rel=0.01)  # 900 SF / 9
        assert out.output["total_sf"] == pytest.approx(
            900.0, rel=0.01
        )  # SF preserved in output

    def test_no_dxf_path_returns_low_confidence(self):
        agent = DXFAreaAgent(
            cost_code="3000",
            config={
                "target_layers": ["A-FINSH-HARD"],
                "min_area_sf": 5.0,
                "unit": "SF",
            },
        )
        out = agent.run(_params(), {}, dxf_local_path=None)

        assert out.quantity is None
        assert out.confidence == "low"
        assert "no_dxf_path" in out.flags

    def test_bad_file_path_returns_low_confidence(self):
        agent = DXFAreaAgent(
            cost_code="3000",
            config={"target_layers": [], "min_area_sf": 0.0, "unit": "SF"},
        )
        out = agent.run(_params(), {}, dxf_local_path="/no/such/file.dxf")

        assert out.quantity == 0.0
        assert out.confidence == "low"
        assert any("dxf_read_error" in f for f in out.flags)

    def test_sums_multiple_polygons(self):
        # Two 10×10 rooms = 200 SF total
        path = _dxf_with_polylines(
            [
                ("A-FINSH-TILE", [(0, 0), (10, 0), (10, 10), (0, 10)]),
                ("A-FINSH-TILE", [(20, 0), (30, 0), (30, 10), (20, 10)]),
            ]
        )
        try:
            agent = DXFAreaAgent(
                cost_code="3100",
                config={
                    "target_layers": ["A-FINSH-TILE"],
                    "min_area_sf": 5.0,
                    "unit": "SF",
                },
            )
            out = agent.run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == pytest.approx(200.0, rel=0.01)
        assert len(out.output["rooms"]) == 2


# ── Factory — dxf_count and dxf_area now implemented ─────────────────────────


def test_factory_dxf_count_windows():
    agent = get_agent("2000")  # Windows
    assert isinstance(agent, DXFCountAgent)


def test_factory_dxf_count_plumbing():
    agent = get_agent("3600")  # Plumbing
    assert isinstance(agent, DXFCountAgent)


def test_factory_dxf_area_hardwood():
    agent = get_agent("3000")  # Hardwood
    assert isinstance(agent, DXFAreaAgent)


def test_factory_dxf_area_carpet():
    agent = get_agent("3300")  # Carpet
    assert isinstance(agent, DXFAreaAgent)


def test_factory_dxf_geometry_now_implemented():
    """dxf_geometry was Phase 12 — now returns DXFGeometryAgent."""
    from agents.dxf_geometry import DXFGeometryAgent

    agent = get_agent("1200")  # Foundation (dxf_geometry)
    assert isinstance(agent, DXFGeometryAgent)
    assert agent.config["geometry_type"] == "perimeter"


# ── Run endpoint — dxf_required_but_not_present ───────────────────────────────


def test_run_dxf_required_but_no_dxf():
    """When a dxf_count agent runs but the project has no DXF, return failed."""
    from main import app

    client = TestClient(app, raise_server_exceptions=False)
    headers = {
        "x-internal-secret": "oakley-internal-dev",
        "x-user-email": "pm@oakleyhomebuilders.com",
        "x-user-role": "pm",
    }
    project_no_dxf = {
        "project_id": "no_dxf_proj",
        "job_name": "No DXF House",
        "locked": False,
        "dxf_gcs_path": None,
        "preprocess_status": None,
    }
    cc_doc = {"cost_code": "2000", "agent_type": "dxf_count", "agent_status": "pending"}

    with (
        patch("main.fs.get_v2_project", return_value=project_no_dxf),
        patch("main.fs.get_cost_code_doc", return_value=cc_doc),
        patch("main.fs.get_shared_params", return_value={}),
        patch(
            "main.gcs.check_dxf_present",
            return_value={"dxf_present": False, "dxf_gcs_path": None},
        ),
        patch("main.fs.log_run", return_value="run-no-dxf"),
        patch("main.fs.save_agent_output"),
    ):
        resp = client.post(
            "/v2/projects/no_dxf_proj/run/2000",
            headers=headers,
        )

    assert resp.status_code == 200
    body = resp.json()
    assert body["agent_status"] == "failed"
    assert "dxf_required_but_not_present" in body["agent_output"]["flags"]
