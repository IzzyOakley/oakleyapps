import os
import sys
import tempfile

import ezdxf
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from dxf_processor import DXFProcessor


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_dxf(
    polylines: dict[str, list[tuple]] | None = None,
    insunits: int = 2,  # 2 = feet
) -> str:
    """
    Write a temp DXF file with closed LWPOLYLINE entities on named layers.
    polylines: {layer_name: [(x, y), ...]}
    Returns the temp file path — caller must os.unlink() it.
    """
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = insunits
    msp = doc.modelspace()

    for layer, points in (polylines or {}).items():
        if not doc.layers.has_entry(layer):
            doc.layers.add(layer)
        lw = msp.add_lwpolyline(points, close=True)
        lw.dxf.layer = layer

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="w") as f:
        path = f.name
    doc.saveas(path)
    return path


def _make_dxf_with_insert(block_name: str, layer: str = "PLUMBING") -> str:
    """Write a DXF with one INSERT entity of the given block name."""
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = 2
    msp = doc.modelspace()
    if not doc.blocks.get(block_name):
        doc.blocks.new(name=block_name)
    ref = msp.add_blockref(block_name, (0, 0))
    ref.dxf.layer = layer

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="w") as f:
        path = f.name
    doc.saveas(path)
    return path


# ── Area extraction tests ─────────────────────────────────────────────────────


class TestAreaExtraction:
    def test_extracts_first_floor_area_from_lwpolyline(self):
        # 10 × 10 ft rectangle → 100 SF
        path = _make_dxf({"FIRST_FLOOR": [(0, 0), (10, 0), (10, 10), (0, 10)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.first_floor_sf == pytest.approx(100.0, rel=0.01)

    def test_extracts_garage_area(self):
        # 20 × 10 ft rectangle → 200 SF
        path = _make_dxf({"GARAGE": [(0, 0), (20, 0), (20, 10), (0, 10)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.garage_sf == pytest.approx(200.0, rel=0.01)

    def test_derives_total_finished_sf(self):
        # first_floor=200, second_floor=100 → total=300
        path = _make_dxf(
            {
                "FIRST_FLOOR": [(0, 0), (20, 0), (20, 10), (0, 10)],
                "SECOND_FLOOR": [(0, 0), (10, 0), (10, 10), (0, 10)],
            }
        )
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.first_floor_sf == pytest.approx(200.0, rel=0.01)
        assert result.second_floor_sf == pytest.approx(100.0, rel=0.01)
        assert result.total_finished_sf == pytest.approx(300.0, rel=0.01)

    def test_area_unit_conversion_inches(self):
        # INSUNITS=1 (inches): 120×120 in = 10ft×10ft = 100 SF
        path = _make_dxf(
            {"FIRST_FLOOR": [(0, 0), (120, 0), (120, 120), (0, 120)]},
            insunits=1,
        )
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.first_floor_sf == pytest.approx(100.0, rel=0.01)

    def test_open_polyline_not_counted(self):
        """An unclosed LWPOLYLINE should contribute 0 area."""
        doc = ezdxf.new()
        doc.header["$INSUNITS"] = 2
        msp = doc.modelspace()
        doc.layers.add("FIRST_FLOOR")
        lw = msp.add_lwpolyline([(0, 0), (10, 0), (10, 10), (0, 10)], close=False)
        lw.dxf.layer = "FIRST_FLOOR"
        with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="w") as f:
            path = f.name
        doc.saveas(path)
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.first_floor_sf == 0.0

    def test_unknown_layer_not_counted(self):
        path = _make_dxf({"RANDOM_LAYER_XYZ": [(0, 0), (10, 0), (10, 10), (0, 10)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.first_floor_sf == 0.0
        assert result.total_finished_sf == 0.0


# ── Confidence tests ──────────────────────────────────────────────────────────


class TestConfidence:
    def test_both_primary_layers_gives_high_confidence(self):
        path = _make_dxf(
            {
                "FIRST_FLOOR": [(0, 0), (10, 0), (10, 10), (0, 10)],
                "FOOTPRINT": [(0, 0), (15, 0), (15, 12), (0, 12)],
            }
        )
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.confidence == "high"

    def test_only_first_floor_gives_medium_confidence(self):
        path = _make_dxf({"FIRST_FLOOR": [(0, 0), (10, 0), (10, 10), (0, 10)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.confidence == "medium"

    def test_no_primary_layers_gives_low_confidence(self):
        # Only basement (not in primary) → low
        path = _make_dxf({"BSMT_FINISHED": [(0, 0), (10, 0), (10, 10), (0, 10)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.confidence == "low"

    def test_empty_dxf_gives_low_confidence(self):
        path = _make_dxf({})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.confidence == "low"

    def test_nonexistent_file_returns_low_no_exception(self):
        result = DXFProcessor("/no/such/file.dxf").extract_shared_params()
        assert result.confidence == "low"
        assert any("dxf_load_error" in f for f in result.flags)


# ── Layer discovery tests ─────────────────────────────────────────────────────


class TestLayerDiscovery:
    def test_found_and_missing_populated(self):
        path = _make_dxf({"FIRST_FLOOR": [(0, 0), (10, 0), (10, 10), (0, 10)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert "FIRST_FLOOR" in result.layers_found
        # FOOTPRINT, SECOND_FLOOR, etc. should be missing
        assert "FOOTPRINT" in result.layers_missing

    def test_all_expected_layers_when_present(self):
        path = _make_dxf(
            {
                "FIRST_FLOOR": [(0, 0), (10, 0), (10, 10), (0, 10)],
                "SECOND_FLOOR": [(0, 0), (8, 0), (8, 8), (0, 8)],
                "FOOTPRINT": [(0, 0), (12, 0), (12, 12), (0, 12)],
                "GARAGE": [(0, 0), (5, 0), (5, 5), (0, 5)],
                "BASEMENT_FINISHED": [(0, 0), (8, 0), (8, 8), (0, 8)],
                "BASEMENT_UNFINISHED": [(0, 0), (4, 0), (4, 4), (0, 4)],
            }
        )
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert set(result.layers_missing) == set()


# ── Count and boolean tests ───────────────────────────────────────────────────


class TestCountsAndBooleans:
    def test_detached_garage_detected(self):
        path = _make_dxf({"DETACHED_GARAGE": [(0, 0), (5, 0), (5, 5), (0, 5)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.has_detached_garage is True

    def test_no_detached_garage_when_absent(self):
        path = _make_dxf({"FIRST_FLOOR": [(0, 0), (10, 0), (10, 10), (0, 10)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.has_detached_garage is False

    def test_full_bathroom_block_counted(self):
        path = _make_dxf_with_insert("FULL_BATH", layer="PLUMBING")
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.bathroom_count_full == 1

    def test_half_bathroom_block_counted(self):
        path = _make_dxf_with_insert("HALF_BATH", layer="PLUMBING")
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.bathroom_count_half == 1

    def test_unrelated_insert_not_counted(self):
        path = _make_dxf_with_insert("WINDOW_UNIT", layer="WINDOWS")
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.bathroom_count_full == 0
        assert result.bathroom_count_half == 0
