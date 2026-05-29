"""
Tests for POST /v2/projects/{project_id}/run/{cost_code} (Phase 10).

All Firestore and GCS calls are mocked — only the agent logic runs for real.

Covers:
  - 200 with sf_formula agent result (Drywall / cost_code 2500)
  - 200 with historical_avg result (no price book data → low confidence)
  - 200 with manual_hold agent → agent_status = manual_required
  - 200 with unimplemented dxf_geometry agent → agent_status = failed (flag)
  - 404 when project not found
  - 404 when cost_code not found in project
  - 409 when project is locked
"""

from __future__ import annotations

from unittest.mock import patch

from fastapi.testclient import TestClient

import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app

CLIENT = TestClient(app, raise_server_exceptions=False)

HEADERS = {
    "x-internal-secret": "oakley-internal-dev",
    "x-user-email": "pm@oakleyhomebuilders.com",
    "x-user-role": "pm",
}

_OPEN_PROJECT = {
    "project_id": "test_proj",
    "job_name": "Test House",
    "locked": False,
    "dxf_gcs_path": None,
    "preprocess_status": "complete",
}

_LOCKED_PROJECT = {**_OPEN_PROJECT, "locked": True}

_CC_DOC = {
    "cost_code": "2500",
    "cost_code_name": "Drywall",
    "agent_type": "sf_formula",
    "agent_status": "pending",
}

_SHARED_PARAMS = {
    "total_finished_sf": 2000.0,
    "garage_sf": 400.0,
    "first_floor_sf": 1200.0,
    "confidence": "high",
    "layers_found": [],
    "layers_missing": [],
    "flags": [],
}


# ── Helpers ───────────────────────────────────────────────────────────────────


def _run(project_id: str = "test_proj", cost_code: str = "2500"):  # noqa: ANN201
    return CLIENT.post(
        f"/v2/projects/{project_id}/run/{cost_code}",
        headers=HEADERS,
    )


# ── 200 — sf_formula agent (Drywall 2500) ────────────────────────────────────


def test_run_sf_formula_drywall():
    """Drywall formula: total_finished_sf * 1.15 = 2000 * 1.15 = 2300."""
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_cost_code_doc", return_value=_CC_DOC),
        patch("main.fs.get_shared_params", return_value=_SHARED_PARAMS),
        patch("main.fs.get_vendor_price_books", return_value={}),
        patch("main.fs.log_run", return_value="run-abc"),
        patch("main.fs.save_agent_output"),
    ):
        resp = _run(cost_code="2500")

    assert resp.status_code == 200
    body = resp.json()
    assert body["project_id"] == "test_proj"
    assert body["cost_code"] == "2500"
    assert body["agent_status"] == "complete"
    assert body["run_id"] == "run-abc"
    output = body["agent_output"]
    assert output["quantity"] == 2300.0
    assert output["unit"] == "SF"
    assert output["confidence"] == "high"
    assert output["source"] == "sf_formula"


def test_run_sf_formula_zero_params_flags():
    """When SharedParams are all zeros a flag is set but agent_status is still complete."""
    zero_params = {k: 0 for k in _SHARED_PARAMS}
    zero_params.update(
        {"confidence": "low", "layers_found": [], "layers_missing": [], "flags": []}
    )
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_cost_code_doc", return_value=_CC_DOC),
        patch("main.fs.get_shared_params", return_value=zero_params),
        patch("main.fs.get_vendor_price_books", return_value={}),
        patch("main.fs.log_run", return_value="run-xyz"),
        patch("main.fs.save_agent_output"),
    ):
        resp = _run(cost_code="2500")

    assert resp.status_code == 200
    body = resp.json()
    assert body["agent_status"] == "complete"
    assert any("all_inputs_zero" in f for f in body["agent_output"]["flags"])


# ── 200 — historical_avg agent (no data → low confidence) ────────────────────


def test_run_historical_avg_no_price_book():
    cc_doc = {**_CC_DOC, "cost_code": "1900", "agent_type": "historical_avg"}
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_cost_code_doc", return_value=cc_doc),
        patch("main.fs.get_shared_params", return_value=_SHARED_PARAMS),
        patch("main.fs.get_vendor_price_books", return_value={}),
        patch("main.fs.log_run", return_value="run-ha"),
        patch("main.fs.save_agent_output"),
    ):
        resp = _run(cost_code="1900")

    assert resp.status_code == 200
    body = resp.json()
    assert body["agent_status"] == "complete"
    output = body["agent_output"]
    assert output["confidence"] == "low"
    assert output["source"] == "historical_avg"
    assert output["quantity"] is None
    assert "no_price_book_data" in output["flags"]


# ── 200 — manual_hold agent → agent_status = manual_required ─────────────────


def test_run_manual_hold():
    cc_doc = {**_CC_DOC, "cost_code": "3800", "agent_type": "manual_hold"}
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_cost_code_doc", return_value=cc_doc),
        patch("main.fs.get_shared_params", return_value=_SHARED_PARAMS),
        patch("main.fs.get_vendor_price_books", return_value={}),
        patch("main.fs.log_run", return_value="run-manual"),
        patch("main.fs.save_agent_output"),
    ):
        resp = _run(cost_code="3800")

    assert resp.status_code == 200
    body = resp.json()
    assert body["agent_status"] == "manual_required"
    assert body["agent_output"]["source"] == "manual"


# ── 200 — unimplemented dxf_geometry → agent_status = failed ─────────────────


def test_run_unimplemented_dxf_type():
    cc_doc = {**_CC_DOC, "cost_code": "1200", "agent_type": "dxf_geometry"}
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_cost_code_doc", return_value=cc_doc),
        patch("main.fs.get_shared_params", return_value=_SHARED_PARAMS),
        patch("main.fs.get_vendor_price_books", return_value={}),
        patch("main.fs.log_run", return_value="run-unimpl"),
        patch("main.fs.save_agent_output"),
    ):
        resp = _run(cost_code="1200")

    assert resp.status_code == 200
    body = resp.json()
    assert body["agent_status"] == "failed"
    assert any("agent_type_not_implemented" in f for f in body["agent_output"]["flags"])


# ── 404 — project not found ───────────────────────────────────────────────────


def test_run_project_not_found():
    with patch("main.fs.get_v2_project", return_value=None):
        resp = _run(project_id="missing_proj")
    assert resp.status_code == 404
    assert "missing_proj" in resp.json()["detail"]


# ── 404 — cost_code not in project ───────────────────────────────────────────


def test_run_cost_code_not_found():
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_cost_code_doc", return_value=None),
    ):
        resp = _run(cost_code="9999")
    assert resp.status_code == 404
    assert "9999" in resp.json()["detail"]


# ── 409 — project locked ──────────────────────────────────────────────────────


def test_run_locked_project():
    with patch("main.fs.get_v2_project", return_value=_LOCKED_PROJECT):
        resp = _run()
    assert resp.status_code == 409
    assert "locked" in resp.json()["detail"].lower()
