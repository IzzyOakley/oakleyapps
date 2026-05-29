"""
DXF-Count Agent — counts INSERT (block reference) entities in the DXF modelspace.

Filtering logic (both filters applied together):
  1. entity.dxf.layer must be in target_layers (case-insensitive).
     If target_layers is empty, all layers are accepted.
  2. entity.dxf.name must contain one of the block_name_patterns (case-insensitive
     substring match).  If block_name_patterns is empty, all block names are accepted.

output:
  {
    "counts_by_type": {matched_pattern: count, ...},
    "total_count": N,
    "target_layers": ["...", ...],
  }

quantity   = float(total_count)
unit       = from agent_config (EA / Fix / Flight / etc.)
confidence = "medium" — layer/block names are best-guess defaults until Phase 16.
source     = "dxf_count"

Plumbing (3600) note:
  The counts_by_type keys are the raw patterns that matched, e.g. "BATH_FULL",
  "TOILET", "SINK".  The frontend maps these to fixture-type labels for display.
"""

from __future__ import annotations

import ezdxf

from agents.base import BaseAgent
from schemas import AgentOutput, SharedParams


def _entity_layer(entity) -> str:
    try:
        return (entity.dxf.layer or "").upper()
    except Exception:
        return ""


class DXFCountAgent(BaseAgent):
    """
    Generic INSERT-entity counter for cost codes that need block counts
    (windows, doors, plumbing fixtures, appliances, fireplaces, stairs …).

    Layer names and block name patterns are expected to be calibrated from
    real Oakley DXF files in Phase 16.
    """

    def run(
        self,
        shared_params: SharedParams,
        price_book_data: dict,
        dxf_local_path: str | None = None,
    ) -> AgentOutput:
        unit: str = self.config.get("unit", "EA")
        target_layers: set[str] = {
            la.upper() for la in self.config.get("target_layers", [])
        }
        patterns: list[str] = [
            p.upper() for p in self.config.get("block_name_patterns", [])
        ]

        if dxf_local_path is None:
            return AgentOutput(
                quantity=None,
                unit=unit,
                output=None,
                source="dxf_count",
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
                output={
                    "counts_by_type": {},
                    "total_count": 0,
                    "target_layers": sorted(target_layers),
                },
                source="dxf_count",
                confidence="low",
                notes=f"Could not read DXF file: {exc}",
                flags=[f"dxf_read_error:{exc!s}"],
            )

        flags: list[str] = []
        counts_by_type: dict[str, int] = {}
        total_count = 0

        try:
            for entity in doc.modelspace():
                if entity.dxftype() != "INSERT":
                    continue

                layer = _entity_layer(entity)
                block_name = (
                    entity.dxf.name.upper() if entity.dxf.hasattr("name") else ""
                )

                # ── Layer filter ──────────────────────────────────────────────
                if target_layers and layer not in target_layers:
                    continue

                # ── Pattern filter ────────────────────────────────────────────
                if patterns:
                    matched = next((p for p in patterns if p in block_name), None)
                    if matched is None:
                        continue
                else:
                    matched = block_name or "UNKNOWN"

                counts_by_type[matched] = counts_by_type.get(matched, 0) + 1
                total_count += 1

        except Exception as exc:
            flags.append(f"modelspace_error:{exc!s}")

        return AgentOutput(
            quantity=float(total_count),
            unit=unit,
            output={
                "counts_by_type": counts_by_type,
                "total_count": total_count,
                "target_layers": sorted(target_layers),
            },
            source="dxf_count",
            confidence="medium",
            notes=None,
            flags=flags,
        )
