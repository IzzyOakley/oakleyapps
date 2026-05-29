"""
Agent factory — resolves a cost_code to its concrete BaseAgent implementation.

Usage:
    from agents import get_agent
    agent = get_agent("2500")
    output = agent.run(shared_params, price_book_data)

Implemented agent types
-----------------------
sf_formula      → SFFormulaAgent
historical_avg  → HistoricalAvgAgent
manual_hold     → ManualHoldAgent
skip            → SkipAgent

Not yet implemented (Phase 11/12) — returns UnimplementedAgent
--------------------------------------------------------------
dxf_count | dxf_area | dxf_geometry | project_flag
"""

from __future__ import annotations

from agent_registry import AGENT_REGISTRY
from agents.base import BaseAgent, ManualHoldAgent, SkipAgent, UnimplementedAgent
from agents.historical_avg import HistoricalAvgAgent
from agents.sf_formula import SFFormulaAgent

_IMPLEMENTED_TYPES: dict[str, type[BaseAgent]] = {
    "sf_formula": SFFormulaAgent,
    "historical_avg": HistoricalAvgAgent,
    "manual_hold": ManualHoldAgent,
    "skip": SkipAgent,
}

_UNIMPLEMENTED_TYPES: frozenset[str] = frozenset(
    {"dxf_count", "dxf_area", "dxf_geometry", "project_flag"}
)


def get_agent(cost_code: str) -> BaseAgent:
    """
    Return the correct BaseAgent subclass for the given cost_code.

    - Unknown cost codes → ManualHoldAgent with a note.
    - Unimplemented types (dxf_count etc.) → UnimplementedAgent with a flag.
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

    # dxf_count / dxf_area / dxf_geometry / project_flag — not yet built
    return UnimplementedAgent(cost_code=cost_code, config=config, agent_type=agent_type)
