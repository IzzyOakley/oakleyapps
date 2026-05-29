"""
Agent base class and built-in agents that require no external data.

All agents implement:
    run(shared_params, price_book_data, dxf_local_path=None) -> AgentOutput

Never raise — use flags and confidence='low' to signal problems.
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from schemas import AgentOutput, SharedParams


class BaseAgent(ABC):
    def __init__(self, cost_code: str, config: dict) -> None:
        self.cost_code = cost_code
        self.config = config

    @abstractmethod
    def run(
        self,
        shared_params: SharedParams,
        price_book_data: dict,
        dxf_local_path: str | None = None,
    ) -> AgentOutput:
        """
        Execute the agent and return a structured AgentOutput.

        shared_params:   SharedParams extracted by the DXF pre-processor.
                         All fields default to 0 if pre-processor has not run.
        price_book_data: {vendor_id: price_book_doc} — used by historical_avg agents.
        dxf_local_path:  Path to a locally downloaded DXF file.
                         Required for dxf_count / dxf_area / dxf_geometry agents.
                         None for sf_formula, historical_avg, manual_hold, skip.
        """


class ManualHoldAgent(BaseAgent):
    """Placeholder for items that require Karen or PM manual entry (Electrical, Lighting, etc.)."""

    def run(
        self,
        shared_params: SharedParams,
        price_book_data: dict,
        dxf_local_path: str | None = None,
    ) -> AgentOutput:
        note = self.config.get("note", "Manual entry required — see cost code detail.")
        return AgentOutput(
            quantity=None,
            unit=self.config.get("unit", "LS"),
            output=None,
            source="manual",
            confidence="low",
            notes=note,
            flags=[],
        )


class SkipAgent(BaseAgent):
    """For profit / non-takeoff items that are intentionally excluded."""

    def run(
        self,
        shared_params: SharedParams,
        price_book_data: dict,
        dxf_local_path: str | None = None,
    ) -> AgentOutput:
        return AgentOutput(
            quantity=None,
            unit=None,
            output=None,
            source="skip",
            confidence="low",
            notes="This item is skipped — not included in the takeoff.",
            flags=[],
        )


class UnimplementedAgent(BaseAgent):
    """
    Placeholder for agent types that will be built in a later phase
    (dxf_geometry, project_flag).
    Returns a clear flag so the PM knows it's pending.
    """

    def __init__(self, cost_code: str, config: dict, agent_type: str) -> None:
        super().__init__(cost_code, config)
        self.agent_type = agent_type

    def run(
        self,
        shared_params: SharedParams,
        price_book_data: dict,
        dxf_local_path: str | None = None,
    ) -> AgentOutput:
        return AgentOutput(
            quantity=None,
            unit=self.config.get("unit"),
            output=None,
            source=self.agent_type,
            confidence="low",
            notes=(
                f"Agent type '{self.agent_type}' is not yet implemented "
                "(coming in Phase 12)."
            ),
            flags=[f"agent_type_not_implemented:{self.agent_type}"],
        )
