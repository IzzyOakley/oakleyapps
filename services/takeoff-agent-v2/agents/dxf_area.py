"""
DXF-Area Agent — sums HATCH and closed-LWPOLYLINE areas on target layers.

Uses the same shoelace-formula helpers as DXFProcessor for consistency.
Area is converted from DXF drawing units to square feet using $INSUNITS.
Polygons smaller than min_area_sf (configurable) are excluded.

output:
  {
    "total_sf": 1234.56,
    "rooms": [{"name": "<layer_title>", "sf": 123.0, "layer": "<LAYER>"}],
  }

quantity   = total_sf (float)
unit       = from agent_config (SF, SY, etc.)
confidence = "medium" — layer names are best-guess defaults until Phase 16.
source     = "dxf_area"

Carpet (3300) note:
  agent_config.unit = "SY".  The total_sf is still stored in output.total_sf
  so downstream can recalculate if needed; quantity is also in SY
  (total_sf / 9).  Override the unit conversion via config if needed.
"""

from __future__ import annotations

import ezdxf

from agents.base import BaseAgent
from dxf_config import INSUNITS_TO_FEET
from dxf_processor import DXFProcessor
from schemas import AgentOutput, SharedParams


def _entity_layer(entity) -> str:
    try:
        return (entity.dxf.layer or "").upper()
    except Exception:
        return ""


class DXFAreaAgent(BaseAgent):
    """
    Generic area-accumulation agent for cost codes that need measured SF/SY
    (hardwood, tile, carpet, masonry …).

    Reads HATCH and closed LWPOLYLINE entities on the configured target layers,
    converts from DXF units to SF, and filters polygons below min_area_sf.
    Layer names are expected to be calibrated from real Oakley DXF files in Phase 16.
    """

    def run(
        self,
        shared_params: SharedParams,
        price_book_data: dict,
        dxf_local_path: str | None = None,
    ) -> AgentOutput:
        unit: str = self.config.get("unit", "SF")
        min_area_sf: float = float(self.config.get("min_area_sf", 0.0))
        target_layers: set[str] = {
            la.upper() for la in self.config.get("target_layers", [])
        }

        if dxf_local_path is None:
            return AgentOutput(
                quantity=None,
                unit=unit,
                output=None,
                source="dxf_area",
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
                output={"total_sf": 0.0, "rooms": []},
                source="dxf_area",
                confidence="low",
                notes=f"Could not read DXF file: {exc}",
                flags=[f"dxf_read_error:{exc!s}"],
            )

        # Unit conversion: drawing units → feet
        insunits = doc.header.get("$INSUNITS", 0)
        lin_per_foot, _ = INSUNITS_TO_FEET.get(insunits, (1.0, "unknown"))

        def _to_sf(area_sq_units: float) -> float:
            if lin_per_foot == 0:
                return area_sq_units
            return round(area_sq_units / (lin_per_foot**2), 2)

        flags: list[str] = []
        rooms: list[dict] = []
        total_sf = 0.0

        try:
            for entity in doc.modelspace():
                layer = _entity_layer(entity)
                if target_layers and layer not in target_layers:
                    continue

                area_sq_units: float | None = None

                if entity.dxftype() == "LWPOLYLINE":
                    try:
                        if entity.is_closed:
                            area_sq_units = abs(DXFProcessor._lwpolyline_area(entity))
                    except Exception as exc:
                        flags.append(f"lwpolyline_error:{exc!s}")

                elif entity.dxftype() == "HATCH":
                    try:
                        for path in entity.paths:
                            # PolylinePath has .vertices; EdgePath (arcs/splines) → Phase 16
                            if hasattr(path, "vertices"):
                                pts = [(v[0], v[1]) for v in path.vertices]
                                hatch_area = abs(DXFProcessor._shoelace_area(pts))
                                if area_sq_units is None:
                                    area_sq_units = hatch_area
                                else:
                                    area_sq_units += hatch_area
                    except Exception as exc:
                        flags.append(f"hatch_error:{exc!s}")

                if area_sq_units is None:
                    continue

                area_sf = _to_sf(area_sq_units)
                if area_sf < min_area_sf:
                    continue

                total_sf += area_sf
                rooms.append(
                    {
                        "name": layer.replace("_", " ").title(),
                        "sf": area_sf,
                        "layer": layer,
                    }
                )

        except Exception as exc:
            flags.append(f"modelspace_error:{exc!s}")

        total_sf = round(total_sf, 2)

        # Convert to SY for carpet (unit="SY")
        quantity = total_sf
        if unit == "SY":
            quantity = round(total_sf / 9.0, 2)

        return AgentOutput(
            quantity=quantity,
            unit=unit,
            output={"total_sf": total_sf, "rooms": rooms},
            source="dxf_area",
            confidence="medium",
            notes=None,
            flags=flags,
        )
