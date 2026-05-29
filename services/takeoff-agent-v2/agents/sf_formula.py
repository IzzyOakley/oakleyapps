"""
SF-Formula Agent — pure arithmetic on SharedParams fields.

Formula strings are evaluated safely using Python's ast module.
Supported operators: + - * /  (no function calls, no attribute access).

Extra conversion factors in agent_config (depth_factor, lumber_factor) are
applied after the formula result and are NOT already embedded in the formula
string — they represent unit conversions (e.g. SF → CY for excavation).

Agents where the multiplier IS part of the formula string (e.g. Drywall
"total_finished_sf * 1.15") do NOT carry an additional factor key.
"""

from __future__ import annotations

import ast

from agents.base import BaseAgent
from schemas import AgentOutput, SharedParams

# Config keys that represent post-formula unit-conversion multipliers.
# These are applied on top of the formula result.
_CONVERSION_FACTOR_KEYS = ("depth_factor", "lumber_factor")


class SFFormulaAgent(BaseAgent):
    """
    Evaluates the formula string from agent_config against SharedParams fields,
    optionally applies a conversion factor, and returns a high-confidence output.

    confidence is always 'high' — the result is fully deterministic.
    quantity=0.0 (not an error) when input fields are 0.
    """

    def run(self, shared_params: SharedParams, price_book_data: dict) -> AgentOutput:
        config = self.config
        formula: str = config.get("formula", "")
        unit: str = config.get("unit", "SF")
        inputs: list[str] = config.get("inputs", [])

        # Build a numeric namespace from SharedParams fields.
        # Skip non-numeric fields (confidence, dxf_file, layers_found, flags, …).
        ns: dict[str, float] = {}
        for field in SharedParams.model_fields:
            val = getattr(shared_params, field, None)
            if isinstance(val, (int, float, bool)):
                ns[field] = float(val)
            elif val is None:
                ns[field] = 0.0
            # else: str / list — omit from formula namespace

        flags: list[str] = []

        # Flag when all inputs are zero (preprocess likely hasn't run yet)
        if inputs and all(ns.get(inp, 0.0) == 0.0 for inp in inputs):
            flags.append("all_inputs_zero — run preprocess first for accurate results")

        try:
            base_qty = float(_safe_eval(formula, ns) or 0.0)
        except Exception as exc:
            return AgentOutput(
                quantity=0.0,
                unit=unit,
                output={"formula_used": formula, "error": str(exc)},
                source="sf_formula",
                confidence="low",
                notes=f"Formula evaluation failed: {exc}",
                flags=[f"formula_eval_error:{exc}"],
            )

        # Apply post-formula unit-conversion factors (e.g. depth_factor for CY)
        for key in _CONVERSION_FACTOR_KEYS:
            if key in config:
                base_qty *= config[key]

        component_breakdown = {inp: ns.get(inp, 0.0) for inp in inputs}

        return AgentOutput(
            quantity=round(base_qty, 2),
            unit=unit,
            output={
                "formula_used": formula,
                "component_breakdown": component_breakdown,
            },
            source="sf_formula",
            confidence="high",
            notes=None,
            flags=flags,
        )


# ── Safe formula evaluator ─────────────────────────────────────────────────────

_SAFE_NODES = (
    ast.Expression,
    ast.BinOp,
    ast.UnaryOp,
    ast.Num,  # Python < 3.8 literal
    ast.Constant,
    ast.Name,
    ast.Add,
    ast.Sub,
    ast.Mult,
    ast.Div,
    ast.USub,
    ast.UAdd,
    ast.Load,
)


def _safe_eval(expr: str, ns: dict) -> float:
    """
    Evaluate a simple arithmetic expression using only names from ns.
    Raises ValueError on any non-arithmetic AST node.
    """
    tree = ast.parse(expr.strip(), mode="eval")
    _check_safe(tree.body)
    return eval(compile(tree, "<formula>", "eval"), {"__builtins__": {}}, ns)


def _check_safe(node: ast.AST) -> None:
    if not isinstance(node, _SAFE_NODES):
        raise ValueError(
            f"Unsafe expression node '{type(node).__name__}' in formula. "
            "Only basic arithmetic (+ - * /) and field names are allowed."
        )
    for child in ast.iter_child_nodes(node):
        _check_safe(child)
