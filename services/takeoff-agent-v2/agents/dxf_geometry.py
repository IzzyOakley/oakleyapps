"""
DXF-Geometry Agent — computes geometric quantities from LWPOLYLINE entities.

Dispatches to one of four geometry types set in agent_config["geometry_type"]:

  perimeter       — Sum foundation-wall LWPOLYLINE perimeters → volume_cy   (1200)
  roof_area       — Sum roof-footprint LWPOLYLINE areas × pitch factor → SQ  (1600)
  wall_area       — Sum exterior-wall LWPOLYLINE areas minus openings → SF   (1700)
  eave_perimeter  — Sum roof-outline LWPOLYLINE perimeters → LF              (3500)

All geometry types:
  - Accept dxf_local_path; return low-confidence when None or unreadable.
  - Convert from DXF drawing units to feet via $INSUNITS.
  - Use target_layers from agent_config (case-insensitive).
  - Use opening_layers for wall_area (defaults to []).
  - Fall back to configured defaults (depth_ft, thickness_ft, pitch) and flag use.
  - confidence = "medium" — layer names are best-guess defaults until Phase 16.

Pitch parsing:
  Scans all TEXT and MTEXT entities in the modelspace for annotations matching
  "N/12" or "N:12".  Uses config["default_pitch"] (e.g. "8/12") if not found,
  and appends "default_pitch_used" to flags.
"""

from __future__ import annotations

import math
import re

import ezdxf

from agents.base import BaseAgent
from dxf_config import INSUNITS_TO_FEET
from dxf_processor import DXFProcessor
from schemas import AgentOutput, SharedParams

# Matches "8/12", "10/12", "6.5/12", "8:12", "8 / 12" etc.
_PITCH_RE = re.compile(r"\b(\d+(?:\.\d+)?)\s*[/:]\s*12\b", re.IGNORECASE)


# ── Geometry helpers ──────────────────────────────────────────────────────────


def _entity_layer(entity) -> str:
    try:
        return (entity.dxf.layer or "").upper()
    except Exception:
        return ""


def _polyline_perimeter(entity) -> float:
    """Sum straight-segment distances between LWPOLYLINE vertices.

    Bulge (arc) segments are approximated as straight chords — sufficient for
    Phase 12 until Phase 16 calibration with real DXF data.
    """
    try:
        pts = [(v[0], v[1]) for v in entity.get_points()]
    except Exception:
        return 0.0
    n = len(pts)
    if n < 2:
        return 0.0
    total = 0.0
    for i in range(n):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % n]
        total += math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2)
    return total


def _parse_pitch_from_doc(doc) -> str | None:
    """Scan all TEXT and MTEXT entities in modelspace for a pitch annotation."""
    for entity in doc.modelspace():
        try:
            if entity.dxftype() == "TEXT":
                txt = entity.dxf.text or ""
            elif entity.dxftype() == "MTEXT":
                try:
                    txt = entity.plain_mtext()
                except AttributeError:
                    txt = entity.text or ""
            else:
                continue
            m = _PITCH_RE.search(txt)
            if m:
                return f"{m.group(1)}/12"
        except Exception:
            continue
    return None


def _pitch_factor(pitch_str: str) -> float:
    """Convert 'N/12' to the slope-length factor sqrt(1 + (N/12)^2)."""
    try:
        rise = float(pitch_str.split("/")[0])
        return math.sqrt(1.0 + (rise / 12.0) ** 2)
    except Exception:
        return math.sqrt(1.0 + (8.0 / 12.0) ** 2)  # default 8/12


# ── Agent ─────────────────────────────────────────────────────────────────────


class DXFGeometryAgent(BaseAgent):
    """
    Generic DXF geometry agent for wall perimeter, roof area, siding area,
    and eave perimeter computations.

    The geometry_type in agent_config selects which computation runs.
    Layer names are best-guess defaults — calibrate from real DXF files
    in Phase 16.
    """

    def run(
        self,
        shared_params: SharedParams,
        price_book_data: dict,
        dxf_local_path: str | None = None,
    ) -> AgentOutput:
        unit: str = self.config.get("unit", "LF")
        geometry_type: str = self.config.get("geometry_type", "perimeter")
        target_layers: set[str] = {
            la.upper() for la in self.config.get("target_layers", [])
        }
        opening_layers: set[str] = {
            la.upper() for la in self.config.get("opening_layers", [])
        }

        if dxf_local_path is None:
            return AgentOutput(
                quantity=None,
                unit=unit,
                output=None,
                source="dxf_geometry",
                confidence="low",
                notes="DXF file not available for this project.",
                flags=["no_dxf_path"],
            )

        try:
            doc = ezdxf.readfile(dxf_local_path)
        except Exception as exc:
            return AgentOutput(
                quantity=0.0,
                unit=unit,
                output=None,
                source="dxf_geometry",
                confidence="low",
                notes=f"Could not read DXF file: {exc}",
                flags=[f"dxf_read_error:{exc!s}"],
            )

        # Unit conversion: drawing units → feet
        insunits = doc.header.get("$INSUNITS", 0)
        lin_per_foot, _ = INSUNITS_TO_FEET.get(insunits, (1.0, "unknown"))

        def _to_lf(drawing_units: float) -> float:
            if lin_per_foot == 0:
                return drawing_units
            return drawing_units / lin_per_foot

        def _to_sf(area_sq_units: float) -> float:
            if lin_per_foot == 0:
                return area_sq_units
            return area_sq_units / (lin_per_foot**2)

        if geometry_type == "perimeter":
            return self._run_perimeter(doc, target_layers, unit, _to_lf)
        elif geometry_type == "roof_area":
            return self._run_roof_area(doc, target_layers, unit, _to_lf, _to_sf)
        elif geometry_type == "wall_area":
            return self._run_wall_area(doc, target_layers, opening_layers, unit, _to_sf)
        elif geometry_type == "eave_perimeter":
            return self._run_eave_perimeter(doc, target_layers, unit, _to_lf)
        else:
            return AgentOutput(
                quantity=None,
                unit=unit,
                output=None,
                source="dxf_geometry",
                confidence="low",
                notes=f"Unknown geometry_type '{geometry_type}'.",
                flags=[f"unknown_geometry_type:{geometry_type}"],
            )

    # ── perimeter → volume_cy (Foundation 1200) ──────────────────────────────

    def _run_perimeter(self, doc, target_layers, unit, to_lf) -> AgentOutput:
        depth_ft: float = self.config.get("depth_ft", 8.0)
        thickness_ft: float = self.config.get("thickness_ft", 0.833)
        flags: list[str] = []
        if "depth_ft" not in self.config:
            flags.append("default_depth_ft_used:8.0")
        if "thickness_ft" not in self.config:
            flags.append("default_thickness_ft_used:0.833")

        perimeter_drawing = 0.0
        try:
            for entity in doc.modelspace():
                if entity.dxftype() != "LWPOLYLINE":
                    continue
                layer = _entity_layer(entity)
                if target_layers and layer not in target_layers:
                    continue
                perimeter_drawing += _polyline_perimeter(entity)
        except Exception as exc:
            flags.append(f"modelspace_error:{exc!s}")

        perimeter_lf = round(to_lf(perimeter_drawing), 2)
        volume_cy = round(perimeter_lf * depth_ft * thickness_ft / 27.0, 2)

        return AgentOutput(
            quantity=volume_cy,
            unit=unit,
            output={
                "perimeter_lf": perimeter_lf,
                "depth_ft": depth_ft,
                "thickness_ft": thickness_ft,
                "volume_cy": volume_cy,
                "target_layers": sorted(target_layers),
            },
            source="dxf_geometry",
            confidence="medium",
            notes=None,
            flags=flags,
        )

    # ── roof_area → SQ (Roofing 1600) ────────────────────────────────────────

    def _run_roof_area(self, doc, target_layers, unit, to_lf, to_sf) -> AgentOutput:
        default_pitch: str = self.config.get("default_pitch", "8/12")
        flags: list[str] = []

        # Parse pitch from DXF text; fall back to default
        pitch_str = _parse_pitch_from_doc(doc)
        if pitch_str is None:
            pitch_str = default_pitch
            flags.append(f"default_pitch_used:{default_pitch}")
        factor = _pitch_factor(pitch_str)

        planes: list[dict] = []
        eave_drawing = 0.0
        total_roof_sf = 0.0

        try:
            for entity in doc.modelspace():
                if entity.dxftype() != "LWPOLYLINE":
                    continue
                layer = _entity_layer(entity)
                if target_layers and layer not in target_layers:
                    continue
                if not entity.is_closed:
                    continue

                footprint_sf = round(
                    to_sf(abs(DXFProcessor._lwpolyline_area(entity))), 2
                )
                roof_sf = round(footprint_sf * factor, 2)
                perimeter = _polyline_perimeter(entity)
                eave_drawing += perimeter
                total_roof_sf += roof_sf

                planes.append(
                    {
                        "footprint_sf": footprint_sf,
                        "area_sf": roof_sf,
                        "pitch": pitch_str,
                        "orientation": "N/A",  # requires Phase 16 calibration
                    }
                )
        except Exception as exc:
            flags.append(f"modelspace_error:{exc!s}")

        total_roof_sf = round(total_roof_sf, 2)
        total_sq = round(total_roof_sf / 100.0, 2)
        eave_lf = round(to_lf(eave_drawing), 2)

        return AgentOutput(
            quantity=total_sq,
            unit=unit,
            output={
                "total_sq": total_sq,
                "total_roof_sf": total_roof_sf,
                "pitch": pitch_str,
                "pitch_factor": round(factor, 4),
                "eave_lf": eave_lf,
                "planes": planes,
                "target_layers": sorted(target_layers),
            },
            source="dxf_geometry",
            confidence="medium",
            notes=None,
            flags=flags,
        )

    # ── wall_area → SF (Siding 1700) ─────────────────────────────────────────

    def _run_wall_area(
        self, doc, target_layers, opening_layers, unit, to_sf
    ) -> AgentOutput:
        flags: list[str] = []
        if not opening_layers:
            flags.append("no_opening_layers_configured")

        gross_wall_area = 0.0
        openings_area = 0.0

        try:
            for entity in doc.modelspace():
                if entity.dxftype() != "LWPOLYLINE":
                    continue
                layer = _entity_layer(entity)

                if target_layers and layer in target_layers:
                    if entity.is_closed:
                        gross_wall_area += abs(DXFProcessor._lwpolyline_area(entity))

                if opening_layers and layer in opening_layers:
                    if entity.is_closed:
                        openings_area += abs(DXFProcessor._lwpolyline_area(entity))

        except Exception as exc:
            flags.append(f"modelspace_error:{exc!s}")

        gross_wall_sf = round(to_sf(gross_wall_area), 2)
        openings_sf = round(to_sf(openings_area), 2)
        net_wall_sf = round(max(gross_wall_sf - openings_sf, 0.0), 2)

        return AgentOutput(
            quantity=net_wall_sf,
            unit=unit,
            output={
                "gross_wall_sf": gross_wall_sf,
                "openings_sf": openings_sf,
                "net_wall_sf": net_wall_sf,
                "target_layers": sorted(target_layers),
                "opening_layers": sorted(opening_layers),
            },
            source="dxf_geometry",
            confidence="medium",
            notes=None,
            flags=flags,
        )

    # ── eave_perimeter → LF (Gutters 3500) ───────────────────────────────────

    def _run_eave_perimeter(self, doc, target_layers, unit, to_lf) -> AgentOutput:
        flags: list[str] = ["by_side_requires_calibration"]
        eave_drawing = 0.0

        try:
            for entity in doc.modelspace():
                if entity.dxftype() != "LWPOLYLINE":
                    continue
                layer = _entity_layer(entity)
                if target_layers and layer not in target_layers:
                    continue
                eave_drawing += _polyline_perimeter(entity)
        except Exception as exc:
            flags.append(f"modelspace_error:{exc!s}")

        eave_perimeter_lf = round(to_lf(eave_drawing), 2)

        return AgentOutput(
            quantity=eave_perimeter_lf,
            unit=unit,
            output={
                "eave_perimeter_lf": eave_perimeter_lf,
                "by_side": [],  # requires Phase 16 DXF calibration
                "target_layers": sorted(target_layers),
            },
            source="dxf_geometry",
            confidence="medium",
            notes=None,
            flags=flags,
        )
