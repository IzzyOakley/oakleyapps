"""
Project-Flag Agent — detects optional features in DXF drawings via Claude.

Extracts all TEXT and MTEXT annotation strings from the DXF modelspace,
passes them as a text corpus to Claude with a structured prompt, and
parses the JSON response to determine whether the specified feature is
present in this project.

agent_config:
  feature (str)  — the feature to detect, e.g. "wine cellar", "pool"
  unit    (str)  — output unit (default "EA")

output:
  {
    "present": bool,
    "evidence": "...",
    "feature": "...",
    "input_tokens": int,
    "output_tokens": int,
    "duration_ms": int,
    "model": "...",
  }

quantity = 1.0 if present else 0.0
unit     = from agent_config (EA)
source   = "project_flag"
confidence = from Claude response ("high" | "medium" | "low")

main.py adds uses_claude=True + token counts to the run log when
result.source == "project_flag".

Flags:
  no_dxf_path             — dxf_local_path is None
  dxf_read_error:<msg>    — ezdxf could not open the file
  no_text_in_dxf          — no TEXT/MTEXT entities found (quantity=0)
  claude_api_key_missing  — ANTHROPIC_API_KEY not set
  claude_api_error:<msg>  — API call failed
  claude_invalid_json     — response could not be parsed as JSON
"""

from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

import anthropic
import ezdxf

from agents.base import BaseAgent
from schemas import AgentOutput, SharedParams

_PROMPT_PATH = Path(__file__).parent.parent / "prompts" / "project_flag_v1.md"

# ── Text extraction helpers ───────────────────────────────────────────────────

_MTEXT_CODE_RE = re.compile(r"\\[a-zA-Z]+[^;]*;|\{[^}]*\}|\\[PpLlO]")


def _plain_mtext(raw: str) -> str:
    """Strip MTEXT formatting codes to get readable text."""
    return _MTEXT_CODE_RE.sub(" ", raw).strip()


def _extract_text_corpus(doc) -> str:
    """Return all TEXT and MTEXT annotation strings joined by newlines."""
    lines: list[str] = []
    for entity in doc.modelspace():
        try:
            if entity.dxftype() == "TEXT":
                txt = (entity.dxf.text or "").strip()
            elif entity.dxftype() == "MTEXT":
                try:
                    txt = entity.plain_mtext().strip()
                except AttributeError:
                    txt = _plain_mtext(entity.text or "").strip()
            else:
                continue
            if txt:
                lines.append(txt)
        except Exception:
            continue
    return "\n".join(lines)


# ── JSON parsing ──────────────────────────────────────────────────────────────

_JSON_RE = re.compile(r"\{.*?\}", re.DOTALL)


def _parse_claude_json(raw: str) -> dict | None:
    """Try to parse Claude's response as JSON.  Returns None on failure."""
    raw = raw.strip()
    # Direct parse first
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass
    # Extract first JSON object from response
    m = _JSON_RE.search(raw)
    if m:
        try:
            return json.loads(m.group(0))
        except json.JSONDecodeError:
            pass
    return None


# ── Agent ─────────────────────────────────────────────────────────────────────


class ProjectFlagAgent(BaseAgent):
    """
    Detects optional construction features (wine cellar, pool, golf simulator,
    sauna, plaster finish, etc.) by passing the DXF text corpus to Claude.

    Uses the MODEL_VERSION env var and logs token usage in AgentOutput.output
    so main.py can include it in the run log.
    """

    def run(
        self,
        shared_params: SharedParams,
        price_book_data: dict,
        dxf_local_path: str | None = None,
    ) -> AgentOutput:
        feature: str = self.config.get("feature", "")
        unit: str = self.config.get("unit", "EA")

        if dxf_local_path is None:
            return AgentOutput(
                quantity=None,
                unit=unit,
                output=None,
                source="project_flag",
                confidence="low",
                notes="DXF file not available for this project.",
                flags=["no_dxf_path"],
            )

        # ── Load DXF ─────────────────────────────────────────────────────────
        try:
            doc = ezdxf.readfile(dxf_local_path)
        except Exception as exc:
            return AgentOutput(
                quantity=0.0,
                unit=unit,
                output=None,
                source="project_flag",
                confidence="low",
                notes=f"Could not read DXF file: {exc}",
                flags=[f"dxf_read_error:{exc!s}"],
            )

        corpus = _extract_text_corpus(doc)
        if not corpus.strip():
            return AgentOutput(
                quantity=0.0,
                unit=unit,
                output={
                    "present": False,
                    "evidence": "No text found in DXF.",
                    "feature": feature,
                },
                source="project_flag",
                confidence="low",
                notes="No TEXT or MTEXT entities found in the DXF modelspace.",
                flags=["no_text_in_dxf"],
            )

        # ── Claude API call ───────────────────────────────────────────────────
        api_key = os.environ.get("ANTHROPIC_API_KEY", "")
        if not api_key:
            return AgentOutput(
                quantity=None,
                unit=unit,
                output=None,
                source="project_flag",
                confidence="low",
                notes="ANTHROPIC_API_KEY is not set.",
                flags=["claude_api_key_missing"],
            )

        model: str = os.environ.get("MODEL_VERSION", "claude-opus-4-5")

        try:
            system_prompt = _PROMPT_PATH.read_text()
        except Exception:
            system_prompt = (
                "Detect whether the feature is present in the DXF text corpus. "
                'Respond with JSON: {"present": bool, "evidence": str, "confidence": str}'
            )

        user_message = (
            f"Feature to detect: {feature}\n\nDXF text corpus:\n{corpus[:12000]}"
        )

        client = anthropic.Anthropic(api_key=api_key)
        t0 = time.monotonic()

        try:
            response = client.messages.create(
                model=model,
                max_tokens=512,
                system=system_prompt,
                messages=[{"role": "user", "content": user_message}],
            )
        except Exception as exc:
            return AgentOutput(
                quantity=None,
                unit=unit,
                output=None,
                source="project_flag",
                confidence="low",
                notes=f"Claude API call failed: {exc}",
                flags=[f"claude_api_error:{exc!s}"],
            )

        duration_ms = round((time.monotonic() - t0) * 1000)
        raw_text: str = response.content[0].text
        input_tokens: int = response.usage.input_tokens
        output_tokens: int = response.usage.output_tokens

        # ── Parse JSON response ───────────────────────────────────────────────
        result_json = _parse_claude_json(raw_text)
        if result_json is None:
            return AgentOutput(
                quantity=None,
                unit=unit,
                output={
                    "raw_response": raw_text,
                    "feature": feature,
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "duration_ms": duration_ms,
                    "model": model,
                },
                source="project_flag",
                confidence="low",
                notes="Claude returned a response that could not be parsed as JSON.",
                flags=["claude_invalid_json"],
            )

        present: bool = bool(result_json.get("present", False))
        evidence: str = result_json.get("evidence", "")
        confidence: str = result_json.get("confidence", "medium")
        if confidence not in ("high", "medium", "low"):
            confidence = "medium"

        quantity = 1.0 if present else 0.0

        return AgentOutput(
            quantity=quantity,
            unit=unit,
            output={
                "present": present,
                "evidence": evidence,
                "feature": feature,
                "input_tokens": input_tokens,
                "output_tokens": output_tokens,
                "duration_ms": duration_ms,
                "model": model,
            },
            source="project_flag",
            confidence=confidence,
            notes=evidence if present else None,
            flags=[],
        )
