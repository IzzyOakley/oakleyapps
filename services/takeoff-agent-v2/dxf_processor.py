"""
DXF Pre-Processor — extract shared geometric parameters from a DXF file.

Entity support:
  - LWPOLYLINE (closed): area via shoelace formula
  - HATCH with PolylinePath boundary: area via shoelace formula
  - INSERT: block name pattern matching for bathroom counts
  - Any entity on a target layer: used for boolean presence checks

Layer names are configured in dxf_config.py.
IMPORTANT: These are best-guess defaults — must be calibrated from real
Oakley DXF files in Phase 16.
"""

import os

import ezdxf

from dxf_config import DXF_LAYER_CONFIG, EXPECTED_LAYERS, INSUNITS_TO_FEET
from schemas import SharedParams


class DXFProcessor:
    def __init__(self, file_path: str) -> None:
        self.file_path = file_path
        self._doc = None
        self._linear_per_foot: float = 1.0  # set after reading $INSUNITS

    # ── Public API ────────────────────────────────────────────────────────────

    def extract_shared_params(self) -> SharedParams:
        """
        Parse the DXF file and return a SharedParams object.

        Never raises — all per-parameter errors are caught and recorded in
        SharedParams.flags so the pipeline continues with partial data.
        """
        flags: list[str] = []

        try:
            self._load()
        except Exception as exc:
            return SharedParams(
                dxf_file=os.path.basename(self.file_path),
                confidence="low",
                flags=[f"dxf_load_error:{exc!s}"],
            )

        params = SharedParams(
            dxf_file=os.path.basename(self.file_path),
            dxf_version=getattr(self._doc, "dxfversion", None),
        )

        params.first_floor_sf = self._extract_area("first_floor_sf", flags)
        params.second_floor_sf = self._extract_area("second_floor_sf", flags)
        params.third_floor_sf = self._extract_area("third_floor_sf", flags)
        params.basement_sf_finished = self._extract_area("basement_sf_finished", flags)
        params.basement_sf_unfinished = self._extract_area(
            "basement_sf_unfinished", flags
        )
        params.garage_sf = self._extract_area("garage_sf", flags)
        params.first_floor_footprint_sf = self._extract_area(
            "first_floor_footprint_sf", flags
        )

        # Derived — not extracted directly from DXF
        params.total_finished_sf = round(
            params.first_floor_sf
            + params.second_floor_sf
            + params.third_floor_sf
            + params.basement_sf_finished,
            2,
        )

        params.bathroom_count_full = self._extract_block_count("bathroom_count_full")
        params.bathroom_count_half = self._extract_block_count("bathroom_count_half")
        params.has_detached_garage = self._has_entities_on_layers("has_detached_garage")

        params.layers_found, params.layers_missing = self._discover_layers()
        params.confidence = self._compute_confidence(params)
        params.flags = flags

        return params

    # ── Private helpers ───────────────────────────────────────────────────────

    def _load(self) -> None:
        self._doc = ezdxf.readfile(self.file_path)
        insunits = self._doc.header.get("$INSUNITS", 0)
        lin_per_foot, _ = INSUNITS_TO_FEET.get(
            insunits, (1.0, "unknown — assuming feet")
        )
        self._linear_per_foot = lin_per_foot

    def _to_sf(self, area_sq_drawing_units: float) -> float:
        """Convert area from drawing units² to square feet."""
        factor = self._linear_per_foot
        if factor == 0:
            return area_sq_drawing_units
        return round(area_sq_drawing_units / (factor**2), 2)

    def _extract_area(self, param_name: str, flags: list[str]) -> float:
        """
        Sum area of closed LWPOLYLINE and HATCH (PolylinePath boundary) entities
        on any of the target layers configured for param_name.
        """
        config = DXF_LAYER_CONFIG.get(param_name, {})
        target_layers = {la.upper() for la in config.get("layers", [])}
        total = 0.0

        try:
            for entity in self._doc.modelspace():
                layer = self._entity_layer(entity)
                if layer not in target_layers:
                    continue

                if entity.dxftype() == "LWPOLYLINE":
                    try:
                        if entity.is_closed:
                            total += abs(self._lwpolyline_area(entity))
                    except Exception as exc:
                        flags.append(f"{param_name}:lwpolyline_error:{exc!s}")

                elif entity.dxftype() == "HATCH":
                    try:
                        for path in entity.paths:
                            # PolylinePath has .vertices; EdgePath (arcs/splines) is Phase 16
                            if hasattr(path, "vertices"):
                                pts = [(v[0], v[1]) for v in path.vertices]
                                total += abs(self._shoelace_area(pts))
                    except Exception as exc:
                        flags.append(f"{param_name}:hatch_error:{exc!s}")

        except Exception as exc:
            flags.append(f"{param_name}:extraction_error:{exc!s}")

        return self._to_sf(total)

    def _extract_block_count(self, param_name: str) -> int:
        """Count INSERT entities whose block name contains any of the block_patterns."""
        config = DXF_LAYER_CONFIG.get(param_name, {})
        patterns = [p.upper() for p in config.get("block_patterns", [])]
        if not patterns:
            return 0

        count = 0
        try:
            for entity in self._doc.modelspace():
                if entity.dxftype() != "INSERT":
                    continue
                block_name = (
                    entity.dxf.name.upper() if entity.dxf.hasattr("name") else ""
                )
                if any(p in block_name for p in patterns):
                    count += 1
        except Exception:
            pass

        return count

    def _has_entities_on_layers(self, param_name: str) -> bool:
        """Return True if any entity exists on any of the configured target layers."""
        config = DXF_LAYER_CONFIG.get(param_name, {})
        target_layers = {la.upper() for la in config.get("layers", [])}
        if not target_layers:
            return False

        try:
            for entity in self._doc.modelspace():
                if self._entity_layer(entity) in target_layers:
                    return True
        except Exception:
            pass

        return False

    @staticmethod
    def _entity_layer(entity) -> str:
        try:
            return (entity.dxf.layer or "").upper()
        except Exception:
            return ""

    @staticmethod
    def _lwpolyline_area(entity) -> float:
        """Compute area of a closed LWPOLYLINE using the shoelace formula."""
        points = [(pt[0], pt[1]) for pt in entity.get_points("xy")]
        return DXFProcessor._shoelace_area(points)

    @staticmethod
    def _shoelace_area(points: list[tuple[float, float]]) -> float:
        n = len(points)
        if n < 3:
            return 0.0
        area = 0.0
        for i in range(n):
            x1, y1 = points[i]
            x2, y2 = points[(i + 1) % n]
            area += x1 * y2 - x2 * y1
        return abs(area) / 2.0

    def _discover_layers(self) -> tuple[list[str], list[str]]:
        """Return (layers_found, layers_missing) vs EXPECTED_LAYERS."""
        try:
            actual = {layer.dxf.name.upper() for layer in self._doc.layers}
        except Exception:
            return [], list(EXPECTED_LAYERS)

        expected_upper = [la.upper() for la in EXPECTED_LAYERS]
        found = [la for la in expected_upper if la in actual]
        missing = [la for la in expected_upper if la not in actual]
        return found, missing

    def _compute_confidence(self, params: SharedParams) -> str:
        """
        high   — both primary-layer areas (first_floor_sf + first_floor_footprint_sf) > 0
        medium — at least one area parameter > 0
        low    — all areas are 0
        """
        primary_ok = params.first_floor_sf > 0 and params.first_floor_footprint_sf > 0
        any_area = any(
            getattr(params, f, 0.0) > 0
            for f in [
                "first_floor_sf",
                "second_floor_sf",
                "garage_sf",
                "first_floor_footprint_sf",
            ]
        )

        if primary_ok:
            return "high"
        if any_area:
            return "medium"
        return "low"
