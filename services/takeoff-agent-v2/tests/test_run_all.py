"""
Tests for POST /v2/projects/{project_id}/run-all (Phase 13.1).

Covers:
  Endpoint behaviour
    - 202 returned immediately with accepted status
    - 404 when project not found
    - 409 when project is locked
    - background task queued (not executed inline in mocked test)

  _run_all_background (tested via direct call with mocked dependencies)
    - updates project status to in_progress then complete
    - runs _execute_agent_sync for every cost_code_doc
    - downloads DXF once for requires_dxf agents
    - passes dxf_local_path=None for non-requires_dxf agents
    - no DXF in project → dxf_local_path=None for all agents (agents handle it)
    - validation agent called after all agents finish
    - validation failure is non-fatal (project still marked complete)
"""

from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import _run_all_background, app

CLIENT = TestClient(app, raise_server_exceptions=False)

HEADERS = {
    "x-internal-secret": "oakley-internal-dev",
    "x-user-email": "pm@oakleyhomebuilders.com",
    "x-user-role": "pm",
}

_OPEN_PROJECT = {
    "project_id": "proj_run_all",
    "job_name": "Run-All House",
    "locked": False,
    "dxf_gcs_path": None,
    "preprocess_status": "complete",
    "status": "pending",
}
_LOCKED_PROJECT = {**_OPEN_PROJECT, "locked": True}

# Two minimal cost_code docs — one requires_dxf, one does not.
# 2000 Windows was moved to historical_avg in Phase 16; use 3600 Plumbing
# (dxf_count, requires_dxf=True) to keep the requires_dxf branch exercised.
_CC_DOCS = [
    {
        "cost_code": "2500",
        "cost_code_name": "Drywall",
        "agent_type": "sf_formula",
        "agent_status": "pending",
    },
    {
        "cost_code": "3600",
        "cost_code_name": "Plumbing",
        "agent_type": "dxf_count",
        "agent_status": "pending",
    },
]

_SHARED_PARAMS = {
    "total_finished_sf": 2000.0,
    "garage_sf": 400.0,
    "first_floor_sf": 1200.0,
    "confidence": "high",
    "layers_found": [],
    "layers_missing": [],
    "flags": [],
}


# ── Endpoint tests ────────────────────────────────────────────────────────────


def test_run_all_returns_202():
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main._run_all_background"),  # don't execute background
    ):
        resp = CLIENT.post(
            "/v2/projects/proj_run_all/run-all",
            headers=HEADERS,
        )

    assert resp.status_code == 202
    body = resp.json()
    assert body["project_id"] == "proj_run_all"
    assert body["status"] == "accepted"


def test_run_all_project_not_found():
    with patch("main.fs.get_v2_project", return_value=None):
        resp = CLIENT.post(
            "/v2/projects/missing/run-all",
            headers=HEADERS,
        )
    assert resp.status_code == 404
    assert "missing" in resp.json()["detail"]


def test_run_all_locked_project():
    with patch("main.fs.get_v2_project", return_value=_LOCKED_PROJECT):
        resp = CLIENT.post(
            "/v2/projects/proj_run_all/run-all",
            headers=HEADERS,
        )
    assert resp.status_code == 409
    assert "locked" in resp.json()["detail"].lower()


def test_run_all_requires_pm_role():
    """Staff role should be rejected."""
    with patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT):
        resp = CLIENT.post(
            "/v2/projects/proj_run_all/run-all",
            headers={**HEADERS, "x-user-role": "staff"},
        )
    assert resp.status_code == 403


# ── Background task tests ─────────────────────────────────────────────────────
# Async tests run via asyncio.run() — no pytest-asyncio dependency.


def test_background_sets_in_progress_then_complete():
    """Status transitions: pending → in_progress → complete."""
    status_calls: list[str] = []

    def _capture_status(pid, status):
        status_calls.append(status)

    with (
        patch("main.fs.update_v2_project_status", side_effect=_capture_status),
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_shared_params", return_value=_SHARED_PARAMS),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
        patch("main.fs.get_vendor_price_books", return_value={}),
        patch("main.gcs.check_dxf_present", return_value={"dxf_gcs_path": None}),
        patch("main._execute_agent_sync", return_value=("complete", {}, "run-1")),
        patch(
            "main.ValidationAgent.run",
            return_value={"validation_status": "complete", "input_tokens": None},
        ),
        patch("main.fs.save_validation_report"),
    ):
        asyncio.run(_run_all_background("proj_run_all", "pm@oakleyhomebuilders.com"))

    assert status_calls[0] == "in_progress"
    assert status_calls[-1] == "complete"


def test_background_calls_execute_for_each_code():
    """_execute_agent_sync called once per cost_code_doc."""
    executed_codes: list[str] = []

    def _capture_exec(project_id, cost_code, *args, **kwargs):
        executed_codes.append(cost_code)
        return "complete", {}, "run-x"

    with (
        patch("main.fs.update_v2_project_status"),
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_shared_params", return_value=_SHARED_PARAMS),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
        patch("main.fs.get_vendor_price_books", return_value={}),
        patch("main.gcs.check_dxf_present", return_value={"dxf_gcs_path": None}),
        patch("main._execute_agent_sync", side_effect=_capture_exec),
        patch(
            "main.ValidationAgent.run",
            return_value={"validation_status": "complete", "input_tokens": None},
        ),
        patch("main.fs.save_validation_report"),
    ):
        asyncio.run(_run_all_background("proj_run_all", "pm@oakleyhomebuilders.com"))

    assert set(executed_codes) == {"2500", "3600"}


def test_background_no_dxf_passes_none_to_dxf_agents():
    """When project has no DXF, dxf_local_path=None for requires_dxf agents."""
    dxf_paths_seen: list = []

    def _capture_exec(
        project_id, cost_code, shared_params, pb_data, dxf_local_path, triggered_by
    ):
        dxf_paths_seen.append((cost_code, dxf_local_path))
        return "failed", {}, "run-x"

    with (
        patch("main.fs.update_v2_project_status"),
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_shared_params", return_value=_SHARED_PARAMS),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
        patch("main.fs.get_vendor_price_books", return_value={}),
        patch(
            "main.gcs.check_dxf_present",
            return_value={"dxf_present": False, "dxf_gcs_path": None},
        ),
        patch("main._execute_agent_sync", side_effect=_capture_exec),
        patch(
            "main.ValidationAgent.run",
            return_value={"validation_status": "complete", "input_tokens": None},
        ),
        patch("main.fs.save_validation_report"),
    ):
        asyncio.run(_run_all_background("proj_run_all", "pm@oakleyhomebuilders.com"))

    # 3600 is requires_dxf — should get None since no DXF in project
    path_for_3600 = next(p for code, p in dxf_paths_seen if code == "3600")
    assert path_for_3600 is None
    # 2500 is NOT requires_dxf — always None
    path_for_2500 = next(p for code, p in dxf_paths_seen if code == "2500")
    assert path_for_2500 is None


def test_background_downloads_dxf_once():
    """DXF downloaded once, shared with all requires_dxf agents."""
    downloaded: list[str] = []

    def _fake_download(path):
        downloaded.append(path)
        return "/tmp/test.dxf"

    project_with_dxf = {**_OPEN_PROJECT, "dxf_gcs_path": "gs://bucket/test.dxf"}

    with (
        patch("main.fs.update_v2_project_status"),
        patch("main.fs.get_v2_project", return_value=project_with_dxf),
        patch("main.fs.get_shared_params", return_value=_SHARED_PARAMS),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
        patch("main.fs.get_vendor_price_books", return_value={}),
        patch("main.gcs.download_dxf_to_temp", side_effect=_fake_download),
        patch("main._execute_agent_sync", return_value=("complete", {}, "run-1")),
        patch(
            "main.ValidationAgent.run",
            return_value={"validation_status": "complete", "input_tokens": None},
        ),
        patch("main.fs.save_validation_report"),
        patch("os.path.exists", return_value=False),
    ):
        asyncio.run(_run_all_background("proj_run_all", "pm@oakleyhomebuilders.com"))

    # DXF downloaded exactly once regardless of how many requires_dxf agents ran
    assert len(downloaded) == 1


def test_background_validation_failure_is_nonfatal():
    """If ValidationAgent.run raises, project is still marked complete."""
    status_calls: list[str] = []

    def _capture_status(pid, status):
        status_calls.append(status)

    with (
        patch("main.fs.update_v2_project_status", side_effect=_capture_status),
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_shared_params", return_value=_SHARED_PARAMS),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
        patch("main.fs.get_vendor_price_books", return_value={}),
        patch("main.gcs.check_dxf_present", return_value={"dxf_gcs_path": None}),
        patch("main._execute_agent_sync", return_value=("complete", {}, "run-1")),
        patch("main.ValidationAgent.run", side_effect=RuntimeError("Claude exploded")),
        patch("main.fs.save_validation_report"),
    ):
        # Should not raise
        asyncio.run(_run_all_background("proj_run_all", "pm@oakleyhomebuilders.com"))

    assert "complete" in status_calls
