"""
Tests for ProjectFlagAgent (Phase 12).

All Claude API calls are mocked — no real API calls are made.
Real ezdxf documents are built in memory for DXF loading paths.

Covers:
  - Feature present → quantity=1, confidence from Claude, notes=evidence
  - Feature absent → quantity=0, confidence from Claude
  - No DXF path → low confidence, no_dxf_path flag
  - Bad DXF path → low confidence, dxf_read_error flag
  - No text in DXF → quantity=0, no_text_in_dxf flag
  - ANTHROPIC_API_KEY missing → low confidence, claude_api_key_missing flag
  - Claude API error → low confidence, claude_api_error flag
  - Claude returns invalid JSON → low confidence, claude_invalid_json flag
  - Claude returns JSON wrapped in markdown → still parsed correctly
  - Token counts stored in output dict
  - Factory: project_flag codes return ProjectFlagAgent

run endpoint:
  - project_flag result logged with uses_claude=True and token counts
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from unittest.mock import MagicMock, patch

import ezdxf

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agents import get_agent
from agents.project_flag import ProjectFlagAgent, _parse_claude_json
from schemas import SharedParams


# ── Helpers ───────────────────────────────────────────────────────────────────


def _params(**kwargs) -> SharedParams:
    return SharedParams(**kwargs)


def _dxf_with_text(texts: list[str], insunits: int = 2) -> str:
    """Write a temp DXF with TEXT entities. Returns file path."""
    doc = ezdxf.new()
    doc.header["$INSUNITS"] = insunits
    msp = doc.modelspace()
    for txt in texts:
        msp.add_text(txt)
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="w") as f:
        path = f.name
    doc.saveas(path)
    return path


def _dxf_empty() -> str:
    """Write a DXF with no text entities."""
    doc = ezdxf.new()
    with tempfile.NamedTemporaryFile(suffix=".dxf", delete=False, mode="w") as f:
        path = f.name
    doc.saveas(path)
    return path


def _make_agent(feature: str = "wine cellar") -> ProjectFlagAgent:
    return ProjectFlagAgent(
        cost_code="4900",
        config={"feature": feature, "unit": "EA"},
    )


def _mock_claude_response(
    present: bool,
    evidence: str,
    confidence: str = "high",
    input_tokens: int = 100,
    output_tokens: int = 50,
):
    """Build a mock anthropic.Anthropic().messages.create() response."""
    response_json = json.dumps(
        {"present": present, "evidence": evidence, "confidence": confidence}
    )
    content = MagicMock()
    content.text = response_json
    usage = MagicMock()
    usage.input_tokens = input_tokens
    usage.output_tokens = output_tokens
    response = MagicMock()
    response.content = [content]
    response.usage = usage
    return response


# ── Core behaviour ────────────────────────────────────────────────────────────


class TestProjectFlagAgent:
    def test_feature_present_quantity_1(self):
        path = _dxf_with_text(["WINE CELLAR", "BAR AREA"])
        mock_response = _mock_claude_response(
            present=True,
            evidence='Room labeled "WINE CELLAR" found on lower level.',
            confidence="high",
            input_tokens=200,
            output_tokens=60,
        )
        try:
            with (
                patch("agents.project_flag.anthropic.Anthropic") as mock_cls,
                patch.dict(
                    os.environ,
                    {
                        "ANTHROPIC_API_KEY": "sk-test",
                        "MODEL_VERSION": "claude-opus-4-5",
                    },
                ),
            ):
                mock_cls.return_value.messages.create.return_value = mock_response
                out = _make_agent("wine cellar").run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == 1.0
        assert out.unit == "EA"
        assert out.confidence == "high"
        assert out.source == "project_flag"
        assert out.notes == 'Room labeled "WINE CELLAR" found on lower level.'
        assert out.flags == []

    def test_feature_absent_quantity_0(self):
        path = _dxf_with_text(["BEDROOM 1", "MASTER BATH"])
        mock_response = _mock_claude_response(
            present=False, evidence="No evidence found.", confidence="high"
        )
        try:
            with (
                patch("agents.project_flag.anthropic.Anthropic") as mock_cls,
                patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-test"}),
            ):
                mock_cls.return_value.messages.create.return_value = mock_response
                out = _make_agent("wine cellar").run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == 0.0
        assert out.confidence == "high"
        assert out.notes is None
        assert out.flags == []

    def test_token_counts_stored_in_output(self):
        path = _dxf_with_text(["SAUNA"])
        mock_response = _mock_claude_response(
            present=True,
            evidence="Sauna room found.",
            confidence="medium",
            input_tokens=350,
            output_tokens=80,
        )
        try:
            with (
                patch("agents.project_flag.anthropic.Anthropic") as mock_cls,
                patch.dict(
                    os.environ,
                    {
                        "ANTHROPIC_API_KEY": "sk-test",
                        "MODEL_VERSION": "claude-opus-4-5",
                    },
                ),
            ):
                mock_cls.return_value.messages.create.return_value = mock_response
                out = _make_agent("sauna").run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.output["input_tokens"] == 350
        assert out.output["output_tokens"] == 80
        assert out.output["model"] == "claude-opus-4-5"
        assert "duration_ms" in out.output
        assert out.output["feature"] == "sauna"

    def test_no_dxf_path_returns_low_confidence(self):
        out = _make_agent().run(_params(), {}, dxf_local_path=None)
        assert out.confidence == "low"
        assert "no_dxf_path" in out.flags
        assert out.quantity is None

    def test_bad_dxf_path_returns_low_confidence(self):
        out = _make_agent().run(_params(), {}, dxf_local_path="/nonexistent/file.dxf")
        assert out.confidence == "low"
        assert any("dxf_read_error" in f for f in out.flags)

    def test_no_text_in_dxf_returns_quantity_0(self):
        path = _dxf_empty()
        try:
            out = _make_agent().run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == 0.0
        assert "no_text_in_dxf" in out.flags
        assert out.confidence == "low"

    def test_missing_api_key_flag(self):
        path = _dxf_with_text(["POOL EQUIPMENT ROOM"])
        try:
            with patch.dict(os.environ, {}, clear=False):
                # Ensure ANTHROPIC_API_KEY is absent
                env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
                with patch.dict(os.environ, env, clear=True):
                    out = _make_agent("pool").run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.confidence == "low"
        assert "claude_api_key_missing" in out.flags
        assert out.quantity is None

    def test_claude_api_error_flagged(self):
        path = _dxf_with_text(["GOLF SIMULATOR"])
        try:
            with (
                patch("agents.project_flag.anthropic.Anthropic") as mock_cls,
                patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-test"}),
            ):
                mock_cls.return_value.messages.create.side_effect = Exception(
                    "Connection refused"
                )
                out = _make_agent("golf simulator").run(
                    _params(), {}, dxf_local_path=path
                )
        finally:
            os.unlink(path)

        assert out.confidence == "low"
        assert any("claude_api_error" in f for f in out.flags)
        assert out.quantity is None

    def test_claude_invalid_json_flagged(self):
        path = _dxf_with_text(["WINE CELLAR"])
        content = MagicMock()
        content.text = "I found a wine cellar in the drawings."  # not JSON
        usage = MagicMock()
        usage.input_tokens = 100
        usage.output_tokens = 20
        response = MagicMock()
        response.content = [content]
        response.usage = usage
        try:
            with (
                patch("agents.project_flag.anthropic.Anthropic") as mock_cls,
                patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-test"}),
            ):
                mock_cls.return_value.messages.create.return_value = response
                out = _make_agent().run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.confidence == "low"
        assert "claude_invalid_json" in out.flags
        assert out.quantity is None

    def test_json_wrapped_in_markdown_still_parsed(self):
        """Claude sometimes wraps JSON in markdown code fences."""
        path = _dxf_with_text(["SAUNA"])
        raw = '```json\n{"present": true, "evidence": "Sauna room found.", "confidence": "high"}\n```'
        content = MagicMock()
        content.text = raw
        usage = MagicMock()
        usage.input_tokens = 100
        usage.output_tokens = 30
        response = MagicMock()
        response.content = [content]
        response.usage = usage
        try:
            with (
                patch("agents.project_flag.anthropic.Anthropic") as mock_cls,
                patch.dict(os.environ, {"ANTHROPIC_API_KEY": "sk-test"}),
            ):
                mock_cls.return_value.messages.create.return_value = response
                out = _make_agent("sauna").run(_params(), {}, dxf_local_path=path)
        finally:
            os.unlink(path)

        assert out.quantity == 1.0
        assert out.confidence == "high"


# ── _parse_claude_json helper ─────────────────────────────────────────────────


def test_parse_clean_json():
    result = _parse_claude_json(
        '{"present": false, "evidence": "None", "confidence": "high"}'
    )
    assert result == {"present": False, "evidence": "None", "confidence": "high"}


def test_parse_json_with_surrounding_text():
    raw = 'Based on my analysis: {"present": true, "evidence": "Wine cellar found", "confidence": "high"} — end'
    result = _parse_claude_json(raw)
    assert result is not None
    assert result["present"] is True


def test_parse_plain_text_returns_none():
    result = _parse_claude_json("No wine cellar found in these drawings.")
    assert result is None


# ── Factory ───────────────────────────────────────────────────────────────────


def test_factory_wine_cellar():
    agent = get_agent("4900")
    assert isinstance(agent, ProjectFlagAgent)
    assert agent.config["feature"] == "wine cellar"


def test_factory_pool():
    agent = get_agent("5000")
    assert isinstance(agent, ProjectFlagAgent)
    assert agent.config["feature"] == "pool"


def test_factory_golf_simulator():
    agent = get_agent("5100")
    assert isinstance(agent, ProjectFlagAgent)
    assert agent.config["feature"] == "golf simulator"


def test_factory_sauna():
    agent = get_agent("5200")
    assert isinstance(agent, ProjectFlagAgent)
    assert agent.config["feature"] == "sauna"


def test_factory_plaster_finish():
    agent = get_agent("5300")
    assert isinstance(agent, ProjectFlagAgent)
    assert agent.config["feature"] == "plaster finish"


# ── run endpoint: uses_claude logged ─────────────────────────────────────────


def test_run_endpoint_logs_uses_claude():
    """project_flag result triggers uses_claude=True in log_run."""
    from fastapi.testclient import TestClient

    from main import app

    client = TestClient(app, raise_server_exceptions=False)
    HEADERS = {
        "x-internal-secret": "oakley-internal-dev",
        "x-user-email": "pm@oakleyhomebuilders.com",
        "x-user-role": "pm",
    }
    project = {
        "project_id": "test_proj",
        "job_name": "Test House",
        "locked": False,
        "dxf_gcs_path": None,
        "preprocess_status": "complete",
    }
    cc_doc = {
        "cost_code": "4900",
        "cost_code_name": "Wine Cellar",
        "agent_type": "project_flag",
        "agent_status": "pending",
    }
    shared = {
        "total_finished_sf": 2000.0,
        "garage_sf": 400.0,
        "first_floor_sf": 1200.0,
        "confidence": "high",
        "layers_found": [],
        "layers_missing": [],
        "flags": [],
    }
    dxf_path = _dxf_with_text(["WINE CELLAR"])
    mock_response = _mock_claude_response(
        present=True,
        evidence="Wine cellar found.",
        confidence="high",
        input_tokens=250,
        output_tokens=55,
    )
    logged: list[dict] = []

    def capture_log(entry):
        logged.append(entry)
        return "run-flag-test"

    try:
        with (
            patch("main.fs.get_v2_project", return_value=project),
            patch("main.fs.get_cost_code_doc", return_value=cc_doc),
            patch("main.fs.get_shared_params", return_value=shared),
            patch(
                "main.gcs.check_dxf_present",
                return_value={
                    "dxf_present": True,
                    "dxf_gcs_path": "projects/Test/file.dxf",
                },
            ),
            patch("main.gcs.download_dxf_to_temp", return_value=dxf_path),
            patch("main.fs.log_run", side_effect=capture_log),
            patch("main.fs.save_agent_output"),
            patch("agents.project_flag.anthropic.Anthropic") as mock_cls,
            patch.dict(
                os.environ,
                {"ANTHROPIC_API_KEY": "sk-test", "MODEL_VERSION": "claude-opus-4-5"},
            ),
        ):
            mock_cls.return_value.messages.create.return_value = mock_response
            resp = client.post("/v2/projects/test_proj/run/4900", headers=HEADERS)
    finally:
        if os.path.exists(dxf_path):
            os.unlink(dxf_path)

    assert resp.status_code == 200
    body = resp.json()
    assert body["agent_status"] == "complete"
    assert body["agent_output"]["quantity"] == 1.0

    assert len(logged) == 1
    entry = logged[0]
    assert entry.get("uses_claude") is True
    assert entry.get("input_tokens") == 250
    assert entry.get("output_tokens") == 55
    assert entry.get("model") == "claude-opus-4-5"
