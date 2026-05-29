"""
Tests for POST /v2/projects/{project_id}/approve (Phase 13.3).

Covers:
  - 200 with snapshot structure (project_id, status, cost_codes, approved_by)
  - 404 when project not found
  - 409 when project already locked (already approved)
  - 422 when project has no cost_code docs
  - saves snapshot to Firestore (save_takeoff_snapshot called)
  - locks project (lock_v2_project called)
  - publishes Pub/Sub message (publish_takeoff_approved called)
  - Pub/Sub failure is non-fatal (pubsub_error field in response)
  - requires management role (staff/pm rejected with 403)
  - snapshot cost_codes contain correct fields
  - pubsub_message_id returned when Pub/Sub succeeds
"""

from __future__ import annotations

import os
import sys
from unittest.mock import patch

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from main import app

CLIENT = TestClient(app, raise_server_exceptions=False)

MGMT_HEADERS = {
    "x-internal-secret": "oakley-internal-dev",
    "x-user-email": "mgmt@oakleyhomebuilders.com",
    "x-user-role": "management",
}

PM_HEADERS = {**MGMT_HEADERS, "x-user-role": "pm"}

_OPEN_PROJECT = {
    "project_id": "proj_approve",
    "job_name": "Approval House",
    "address": "123 Main St",
    "locked": False,
    "dxf_gcs_path": "gs://bucket/test.dxf",
    "estimate_pdf_gcs_path": None,
    "validation_report": None,
    "status": "complete",
}
_LOCKED_PROJECT = {**_OPEN_PROJECT, "locked": True}

_CC_DOCS = [
    {
        "cost_code": "2500",
        "cost_code_name": "Drywall",
        "category": "Interior",
        "agent_status": "complete",
        "quantity": 2300.0,
        "unit": "SF",
        "estimate_final_cost": 9200.0,
        "source": "sf_formula",
        "confidence": "high",
        "flags": [],
    },
    {
        "cost_code": "3800",
        "cost_code_name": "Electrical",
        "category": "MEP",
        "agent_status": "manual_required",
        "quantity": None,
        "unit": "LS",
        "estimate_final_cost": 45000.0,
        "source": "manual",
        "confidence": None,
        "flags": [],
    },
]


def _post_approve(project_id: str = "proj_approve", headers=None):
    return CLIENT.post(
        f"/v2/projects/{project_id}/approve",
        headers=headers or MGMT_HEADERS,
    )


# ── 200 — happy path ──────────────────────────────────────────────────────────


def test_approve_returns_200_with_snapshot():
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
        patch("main.fs.save_takeoff_snapshot"),
        patch("main.fs.lock_v2_project"),
        patch(
            "main.pubsub_client.publish_takeoff_approved",
            return_value="msg-id-123",
        ),
    ):
        resp = _post_approve()

    assert resp.status_code == 200
    body = resp.json()
    assert body["project_id"] == "proj_approve"
    assert body["status"] == "approved"
    assert body["approved_by"] == "mgmt@oakleyhomebuilders.com"
    assert body["pubsub_message_id"] == "msg-id-123"
    assert body["pubsub_error"] is None


def test_approve_snapshot_has_correct_structure():
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
        patch("main.fs.save_takeoff_snapshot"),
        patch("main.fs.lock_v2_project"),
        patch("main.pubsub_client.publish_takeoff_approved", return_value="msg-1"),
    ):
        resp = _post_approve()

    snapshot = resp.json()["snapshot"]
    assert snapshot["project_id"] == "proj_approve"
    assert snapshot["job_name"] == "Approval House"
    assert snapshot["status"] == "approved"
    assert snapshot["schema_version"] == "v2"
    assert len(snapshot["cost_codes"]) == 2

    cc = snapshot["cost_codes"][0]
    assert cc["cost_code"] == "2500"
    assert cc["quantity"] == 2300.0
    assert cc["agent_status"] == "complete"


def test_approve_saves_takeoff_snapshot():
    saved: list[tuple] = []

    def _capture_save(project_id, snapshot):
        saved.append((project_id, snapshot))

    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
        patch("main.fs.save_takeoff_snapshot", side_effect=_capture_save),
        patch("main.fs.lock_v2_project"),
        patch("main.pubsub_client.publish_takeoff_approved", return_value="msg-1"),
    ):
        _post_approve()

    assert len(saved) == 1
    assert saved[0][0] == "proj_approve"
    assert saved[0][1]["status"] == "approved"


def test_approve_locks_project():
    locked: list[tuple] = []

    def _capture_lock(project_id, locked_by):
        locked.append((project_id, locked_by))

    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
        patch("main.fs.save_takeoff_snapshot"),
        patch("main.fs.lock_v2_project", side_effect=_capture_lock),
        patch("main.pubsub_client.publish_takeoff_approved", return_value="msg-1"),
    ):
        _post_approve()

    assert len(locked) == 1
    assert locked[0] == ("proj_approve", "mgmt@oakleyhomebuilders.com")


def test_approve_publishes_pubsub():
    published: list[tuple] = []

    def _capture_publish(project_id, extra):
        published.append((project_id, extra))
        return "msg-published"

    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
        patch("main.fs.save_takeoff_snapshot"),
        patch("main.fs.lock_v2_project"),
        patch("main.pubsub_client.publish_takeoff_approved", side_effect=_capture_publish),
    ):
        resp = _post_approve()

    assert len(published) == 1
    assert published[0][0] == "proj_approve"
    assert published[0][1]["job_name"] == "Approval House"
    assert resp.json()["pubsub_message_id"] == "msg-published"


def test_approve_pubsub_failure_nonfatal():
    """Pub/Sub error should not cause 500 — pubsub_error field populated instead."""
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
        patch("main.fs.save_takeoff_snapshot"),
        patch("main.fs.lock_v2_project"),
        patch(
            "main.pubsub_client.publish_takeoff_approved",
            side_effect=RuntimeError("topic not found"),
        ),
    ):
        resp = _post_approve()

    assert resp.status_code == 200
    body = resp.json()
    assert body["pubsub_message_id"] is None
    assert "topic not found" in body["pubsub_error"]


# ── Error cases ───────────────────────────────────────────────────────────────


def test_approve_project_not_found():
    with patch("main.fs.get_v2_project", return_value=None):
        resp = _post_approve(project_id="missing_proj")
    assert resp.status_code == 404
    assert "missing_proj" in resp.json()["detail"]


def test_approve_already_locked():
    with patch("main.fs.get_v2_project", return_value=_LOCKED_PROJECT):
        resp = _post_approve()
    assert resp.status_code == 409
    assert "locked" in resp.json()["detail"].lower()


def test_approve_no_cost_codes():
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_all_cost_code_docs", return_value=[]),
    ):
        resp = _post_approve()
    assert resp.status_code == 422
    assert "cost code" in resp.json()["detail"].lower()


# ── Role enforcement ──────────────────────────────────────────────────────────


def test_approve_pm_rejected():
    """PM role cannot approve — requires management or admin."""
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
    ):
        resp = _post_approve(headers=PM_HEADERS)
    assert resp.status_code == 403


def test_approve_staff_rejected():
    staff_headers = {**MGMT_HEADERS, "x-user-role": "staff"}
    with patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT):
        resp = _post_approve(headers=staff_headers)
    assert resp.status_code == 403


def test_approve_admin_allowed():
    admin_headers = {**MGMT_HEADERS, "x-user-role": "admin"}
    with (
        patch("main.fs.get_v2_project", return_value=_OPEN_PROJECT),
        patch("main.fs.get_all_cost_code_docs", return_value=_CC_DOCS),
        patch("main.fs.save_takeoff_snapshot"),
        patch("main.fs.lock_v2_project"),
        patch("main.pubsub_client.publish_takeoff_approved", return_value="msg-admin"),
    ):
        resp = _post_approve(headers=admin_headers)
    assert resp.status_code == 200
