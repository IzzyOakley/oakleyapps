"""
Agent factory — resolves a cost_code to its concrete BaseAgent implementation.

Usage:
    from agents import get_agent
    agent = get_agent("2500")
    output = agent.run(shared_params, price_book_data, dxf_local_path=path)

Implemented agent types
-----------------------
sf_formula      → SFFormulaAgent
historical_avg  → HistoricalAvgAgent
manual_hold     → ManualHoldAgent
skip            → SkipAgent
dxf_count       → DXFCountAgent      (Phase 11)
dxf_area        → DXFAreaAgent       (Phase 11)
dxf_geometry    → DXFGeometryAgent   (Phase 12)
project_flag    → ProjectFlagAgent   (Phase 12)

Unknown types fall back to UnimplementedAgent (future phases).
"""

from __future__ import annotations

from agent_registry import AGENT_REGISTRY
from agents.base import BaseAgent, ManualHoldAgent, SkipAgent, UnimplementedAgent
from agents.dxf_area import DXFAreaAgent
from agents.dxf_count import DXFCountAgent
from agents.dxf_geometry import DXFGeometryAgent
from agents.historical_avg import HistoricalAvgAgent
from agents.project_flag import ProjectFlagAgent
from agents.sf_formula import SFFormulaAgent

_IMPLEMENTED_TYPES: dict[str, type[BaseAgent]] = {
    "sf_formula": SFFormulaAgent,
    "historical_avg": HistoricalAvgAgent,
    "manual_hold": ManualHoldAgent,
    "skip": SkipAgent,
    "dxf_count": DXFCountAgent,
    "dxf_area": DXFAreaAgent,
    "dxf_geometry": DXFGeometryAgent,
    "project_flag": ProjectFlagAgent,
}

_UNIMPLEMENTED_TYPES: frozenset[str] = (
    frozenset()
)  # all types implemented through Phase 12


def get_agent(cost_code: str) -> BaseAgent:
    """
    Return the correct BaseAgent subclass for the given cost_code.

    - Unknown cost codes → ManualHoldAgent with a note.
    - Unimplemented types (dxf_geometry, project_flag) → UnimplementedAgent with a flag.
    - Any other future unknown type → UnimplementedAgent.
    """
    entry = AGENT_REGISTRY.get(cost_code)
    if entry is None:
        return ManualHoldAgent(
            cost_code=cost_code,
            config={
                "note": (
                    f"Cost code '{cost_code}' is not in the agent registry "
                    "— manual entry required."
                ),
                "unit": "LS",
            },
        )

    agent_type: str = entry.get("agent_type", "manual_hold")
    config: dict = entry.get("agent_config", {})

    cls = _IMPLEMENTED_TYPES.get(agent_type)
    if cls is not None:
        return cls(cost_code=cost_code, config=config)

    # Unknown agent type — will be implemented in a future phase
    return UnimplementedAgent(cost_code=cost_code, config=config, agent_type=agent_type)
