"""Analyze a project notes PDF with Claude and extract bid-relevant scope."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os

import anthropic
from json_repair import repair_json

logger = logging.getLogger(__name__)

MODEL_VERSION = os.environ.get("MODEL_VERSION", "claude-opus-4-6")

_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    return _client


async def analyze_project_notes(pdf_bytes: bytes, project_name: str) -> dict:
    """
    Analyze a project notes PDF and return structured context for bid generation.

    Returns:
      {
        "summary": str,
        "additional_scope": [{"trade_hint": str, "description": str, "notes": str}],
        "special_requirements": [str],
        "constraints": [str],
        "allowances": [str]
      }
    """
    b64 = base64.standard_b64encode(pdf_bytes).decode()

    system_prompt = (
        "You are a construction project analyst for Oakley Home Builders. "
        "Analyze project notes documents and extract information relevant to bid generation. "
        "Focus on: scope items beyond standard blueprints, special materials or finishes, "
        "site constraints, client preferences, allowances, exclusions, and any additional "
        "work items that vendors must price for."
    )

    user_content: list[dict] = [
        {
            "type": "document",
            "source": {
                "type": "base64",
                "media_type": "application/pdf",
                "data": b64,
            },
        },
        {
            "type": "text",
            "text": (
                f"Project: {project_name}\n\n"
                "Extract bid-relevant information from these project notes. "
                "Return valid JSON only:\n"
                "{\n"
                '  "summary": "1-2 sentence summary of key notes",\n'
                '  "additional_scope": [\n'
                '    {"trade_hint": "trade name e.g. Roofing", "description": "scope item", "notes": "details"}\n'
                "  ],\n"
                '  "special_requirements": ["requirement 1"],\n'
                '  "constraints": ["constraint 1"],\n'
                '  "allowances": ["allowance 1"]\n'
                "}"
            ),
        },
    ]

    def _call() -> str:
        msg = _get_client().messages.create(
            model=MODEL_VERSION,
            max_tokens=2048,
            system=system_prompt,
            messages=[{"role": "user", "content": user_content}],
        )
        return msg.content[0].text

    raw = await asyncio.to_thread(_call)
    logger.info("notes_analyzer response prefix: %s", raw[:200])

    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return json.loads(repair_json(raw))
