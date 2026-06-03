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
    mtext_entries: list[tuple[str, str]] | None = None,
) -> str:
    """
    Write a temp DXF file with closed LWPOLYLINE entities and/or MTEXT on named layers.
    polylines: {layer_name: [(x, y), ...]}
    mtext_entries: [(layer_name, text_content), ...]
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

    for layer, text in mtext_entries or []:
        if not doc.layers.has_entry(layer):
            doc.layers.add(layer)
        mt = msp.add_mtext(text, dxfattribs={"layer": layer})
        mt.dxf.layer = layer

    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="w") as f:
        path = f.name
    doc.saveas(path)
    return path


def _make_dxf_with_insert(block_name: str, layer: str = "STD-PLUMB-FIX") -> str:
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


# ── MTEXT area schedule parsing tests ────────────────────────────────────────


class TestMtextParsing:
    def test_decode_area_mtext_oakley_format(self):
        """Parse the real Oakley MTEXT area schedule format."""
        raw = "FIRST FLOOR^I^I^I2,752 SQ. FT.\\P{\\LSECOND FLOOR^I^I  876 SQ. FT.\\P}TOTAL              ^I^I3,628 SQ. FT."
        result = DXFProcessor._decode_area_mtext(raw)
        assert result["FIRST FLOOR"] == pytest.approx(2752.0)
        assert result["SECOND FLOOR"] == pytest.approx(876.0)
        assert result["TOTAL"] == pytest.approx(3628.0)

    def test_decode_area_mtext_with_garage(self):
        raw = "FIRST FLOOR  1,500 SQ. FT.\\PGARAGE  400 SQ. FT.\\PTOTAL  1,900 SQ. FT."
        result = DXFProcessor._decode_area_mtext(raw)
        assert result["FIRST FLOOR"] == pytest.approx(1500.0)
        assert result["GARAGE"] == pytest.approx(400.0)
        assert result["TOTAL"] == pytest.approx(1900.0)

    def test_decode_area_mtext_empty(self):
        result = DXFProcessor._decode_area_mtext("just some text")
        assert result == {}

    def test_extract_shared_params_uses_mtext_schedule(self):
        """extract_shared_params should use STD-AREA MTEXT values directly."""
        raw = "FIRST FLOOR^I^I2,752 SQ. FT.\\PSECOND FLOOR^I876 SQ. FT.\\PTOTAL^I3,628 SQ. FT."
        path = _make_dxf(mtext_entries=[("STD-AREA", raw)])
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.first_floor_sf == pytest.approx(2752.0)
        assert result.second_floor_sf == pytest.approx(876.0)
        # total_finished_sf = TOTAL from MTEXT + basement (0) = 3628
        assert result.total_finished_sf == pytest.approx(3628.0)
        assert any("mtext_schedule" in f for f in result.flags)

    def test_extract_shared_params_mtext_high_confidence(self):
        """When MTEXT gives first_floor_sf > 0, confidence should be high."""
        raw = "FIRST FLOOR  2,000 SQ. FT.\\PTOTAL  2,000 SQ. FT."
        path = _make_dxf(mtext_entries=[("STD-AREA", raw)])
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.confidence == "high"


# ── Area extraction tests (LWPOLYLINE fallback on STD-AREA) ──────────────────


class TestAreaExtraction:
    def test_extracts_first_floor_area_from_lwpolyline_fallback(self):
        """When no MTEXT, STD-AREA LWPOLYLINE area lands in first_floor_sf via fallback."""
        # 10 × 10 ft rectangle → 100 SF, no MTEXT on STD-AREA
        path = _make_dxf({"STD-AREA": [(0, 0), (10, 0), (10, 10), (0, 10)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        # fallback: all STD-AREA polygons go to first_floor_sf
        assert result.first_floor_sf == pytest.approx(100.0, rel=0.01)

    def test_area_unit_conversion_inches(self):
        # INSUNITS=1 (inches): 120×120 in = 10ft×10ft = 100 SF via MTEXT
        raw = "FIRST FLOOR  100 SQ. FT.\\PTOTAL  100 SQ. FT."
        path = _make_dxf(
            mtext_entries=[("STD-AREA", raw)],
            insunits=1,
        )
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.first_floor_sf == pytest.approx(100.0, rel=0.01)

    def test_open_polyline_not_counted(self):
        """An unclosed LWPOLYLINE should contribute 0 area in fallback mode."""
        doc = ezdxf.new()
        doc.header["$INSUNITS"] = 2
        msp = doc.modelspace()
        doc.layers.add("STD-AREA")
        lw = msp.add_lwpolyline([(0, 0), (10, 0), (10, 10), (0, 10)], close=False)
        lw.dxf.layer = "STD-AREA"
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

    def test_basement_areas_from_bsmt_file(self):
        """Basement areas come from a separate bsmt DXF (two STD-AREA polygons)."""
        # 40×37.1 ft ≈ 1484.8 SF (finished), 37.2×37.2 ft ≈ 1383.8 SF (unfinished)
        bsmt_path = _make_dxf(
            {
                "STD-AREA": [
                    (0, 0),
                    (40, 0),
                    (40, 37.1),
                    (0, 37.1),
                ]
            }
        )
        bsmt_path2 = _make_dxf(
            {
                "STD-AREA": [
                    (0, 0),
                    (37.2, 0),
                    (37.2, 37.2),
                    (0, 37.2),
                ]
            }
        )
        # Merge both into one file
        doc = ezdxf.new()
        doc.header["$INSUNITS"] = 2
        msp = doc.modelspace()
        doc.layers.add("STD-AREA")
        for pts in [
            [(0, 0), (40, 0), (40, 37.1), (0, 37.1)],
            [(0, 0), (37.2, 0), (37.2, 37.2), (0, 37.2)],
        ]:
            lw = msp.add_lwpolyline(pts, close=True)
            lw.dxf.layer = "STD-AREA"
        with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="w") as f:
            bsmt_combined = f.name
        doc.saveas(bsmt_combined)
        os.unlink(bsmt_path)
        os.unlink(bsmt_path2)

        primary = _make_dxf(
            mtext_entries=[
                ("STD-AREA", "FIRST FLOOR  2,000 SQ. FT.\\PTOTAL  2,000 SQ. FT.")
            ]
        )
        try:
            result = DXFProcessor(primary).extract_shared_params(
                bsmt_file_path=bsmt_combined
            )
        finally:
            os.unlink(primary)
            os.unlink(bsmt_combined)
        # Larger = finished (40×37.1 = 1484 SF), smaller = unfinished (37.2² = 1383.8 SF)
        assert result.basement_sf_finished == pytest.approx(40 * 37.1, rel=0.01)
        assert result.basement_sf_unfinished == pytest.approx(37.2 * 37.2, rel=0.01)


# ── Confidence tests ──────────────────────────────────────────────────────────


class TestConfidence:
    def test_first_floor_from_mtext_gives_high_confidence(self):
        raw = "FIRST FLOOR  2,000 SQ. FT.\\PTOTAL  2,000 SQ. FT."
        path = _make_dxf(mtext_entries=[("STD-AREA", raw)])
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.confidence == "high"

    def test_no_areas_gives_low_confidence(self):
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

    def test_only_lwpolyline_fallback_gives_medium_or_high(self):
        """STD-AREA LWPOLYLINE without MTEXT triggers fallback; first_floor_sf > 0 → high."""
        path = _make_dxf({"STD-AREA": [(0, 0), (10, 0), (10, 10), (0, 10)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        # first_floor_sf > 0 via fallback → high
        assert result.confidence == "high"


# ── Layer discovery tests ─────────────────────────────────────────────────────


class TestLayerDiscovery:
    def test_std_area_found_in_expected(self):
        path = _make_dxf({"STD-AREA": [(0, 0), (10, 0), (10, 10), (0, 10)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert "STD-AREA" in result.layers_found

    def test_missing_layers_reported(self):
        path = _make_dxf({"STD-AREA": [(0, 0), (10, 0), (10, 10), (0, 10)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        # STD-WALL, STD-OPENING, STD-PLUMB-FIX, P-BLDG should be missing
        assert "STD-WALL" in result.layers_missing

    def test_all_expected_layers_when_present(self):
        path = _make_dxf(
            {
                "STD-AREA": [(0, 0), (10, 0), (10, 10), (0, 10)],
                "STD-WALL": [(0, 0), (8, 0), (8, 8), (0, 8)],
                "STD-OPENING": [(0, 0), (12, 0), (12, 12), (0, 12)],
                "STD-PLUMB-FIX": [(0, 0), (5, 0), (5, 5), (0, 5)],
                "P-BLDG": [(0, 0), (8, 0), (8, 8), (0, 8)],
            }
        )
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert set(result.layers_missing) == set()


# ── Count and boolean tests ───────────────────────────────────────────────────


class TestCountsAndBooleans:
    def test_detached_garage_detected_via_future_layer(self):
        path = _make_dxf({"STD-FUTURE 1": [(0, 0), (5, 0), (5, 5), (0, 5)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.has_detached_garage is True

    def test_no_detached_garage_when_absent(self):
        path = _make_dxf({"STD-AREA": [(0, 0), (10, 0), (10, 10), (0, 10)]})
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.has_detached_garage is False

    def test_full_bathroom_block_counted(self):
        path = _make_dxf_with_insert("WC-STD", layer="STD-PLUMB-FIX")
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.bathroom_count_full == 1

    def test_half_bathroom_block_counted(self):
        path = _make_dxf_with_insert("WC-HALF", layer="STD-PLUMB-FIX")
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.bathroom_count_half == 1

    def test_unrelated_insert_not_counted(self):
        path = _make_dxf_with_insert("WINDOW_UNIT", layer="STD-WALL")
        try:
            result = DXFProcessor(path).extract_shared_params()
        finally:
            os.unlink(path)
        assert result.bathroom_count_full == 0
        assert result.bathroom_count_half == 0
