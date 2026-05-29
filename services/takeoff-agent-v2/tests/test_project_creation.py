import io
import json
import os
import sys
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from main import app

AUTH_HEADERS = {
    "x-user-email": "pm@oakleyhomebuilders.com",
    "x-user-role": "pm",
    "x-internal-secret": "oakley-internal-dev",
}

client = TestClient(app)


def _mock_cost_codes_map():
    return {
        "3600": {
            "name": "Plumbing Rough",
            "category": "Plumbing",
            "is_profit_item": False,
        },
        "3700": {"name": "HVAC", "category": "HVAC", "is_profit_item": False},
    }


def _mock_airtable_project():
    return {
        "record_id": "recABC123",
        "job_name": "Test Home",
        "address": "123 Main St",
        "reference_home_ids": [],
    }


class TestCreateFromAirtable:
    def test_returns_201_and_v2project(self):
        with (
            patch("main.fs.v2_project_exists", return_value=False),
            patch("main.AirtableClient.__init__", return_value=None),
            patch(
                "main.AirtableClient.get_contract_signed_projects",
                return_value=[_mock_airtable_project()],
            ),
            patch(
                "main.AirtableClient.get_estimate_lines",
                return_value=[MagicMock(cost_code="3600", final_cost=32000.0)],
            ),
            patch(
                "main.fs.get_all_cost_codes_map", return_value=_mock_cost_codes_map()
            ),
            patch(
                "main.gcs.check_dxf_present",
                return_value={"dxf_present": False, "dxf_gcs_path": None},
            ),
            patch("main.fs.create_v2_project_batch"),
        ):
            resp = client.post(
                "/v2/projects/from-airtable",
                json={"airtable_record_id": "recABC123"},
                headers=AUTH_HEADERS,
            )

        assert resp.status_code == 201
        data = resp.json()
        assert data["project_source"] == "airtable"
        assert data["airtable_record_id"] == "recABC123"

    def test_returns_409_if_already_exists(self):
        with patch("main.fs.v2_project_exists", return_value=True):
            resp = client.post(
                "/v2/projects/from-airtable",
                json={"airtable_record_id": "recABC123"},
                headers=AUTH_HEADERS,
            )
        assert resp.status_code == 409

    def test_returns_404_if_record_not_found(self):
        with (
            patch("main.fs.v2_project_exists", return_value=False),
            patch("main.AirtableClient.__init__", return_value=None),
            patch("main.AirtableClient.get_contract_signed_projects", return_value=[]),
        ):
            resp = client.post(
                "/v2/projects/from-airtable",
                json={"airtable_record_id": "recNONE"},
                headers=AUTH_HEADERS,
            )
        assert resp.status_code == 404

    def test_requires_pm_role(self):
        resp = client.post(
            "/v2/projects/from-airtable",
            json={"airtable_record_id": "recABC123"},
            headers={**AUTH_HEADERS, "x-user-role": "staff"},
        )
        assert resp.status_code == 403


class TestCreateFromGCS:
    def _valid_pdf_bytes(self):
        return b"%PDF-1.4 fake"

    def _post(self, folder_name="Test Home", corrected_lines="[]", pdf=None):
        if pdf is None:
            pdf = self._valid_pdf_bytes()
        return client.post(
            "/v2/projects/from-gcs",
            data={"folder_name": folder_name, "corrected_lines": corrected_lines},
            files={
                "estimate_pdf": ("estimate.pdf", io.BytesIO(pdf), "application/pdf")
            },
            headers=AUTH_HEADERS,
        )

    def test_returns_201_on_success(self):
        from schemas import EstimateLine

        with (
            patch("main.fs.v2_project_exists", return_value=False),
            patch(
                "main.EstimateParser.parse",
                return_value=[EstimateLine(cost_code="3600", final_cost=32000.0)],
            ),
            patch(
                "main.gcs.upload_estimate_pdf",
                return_value="projects/Test Home/estimate/estimate.pdf",
            ),
            patch(
                "main.gcs.check_dxf_present",
                return_value={"dxf_present": False, "dxf_gcs_path": None},
            ),
            patch(
                "main.fs.get_all_cost_codes_map", return_value=_mock_cost_codes_map()
            ),
            patch("main.fs.create_v2_project_batch"),
        ):
            resp = self._post()

        assert resp.status_code == 201
        data = resp.json()
        assert data["project_source"] == "gcs"

    def test_returns_422_when_pdf_unparseable(self):
        from estimate_parser import EstimateParseError

        with (
            patch("main.fs.v2_project_exists", return_value=False),
            patch(
                "main.EstimateParser.parse",
                side_effect=EstimateParseError("no tables", raw_extraction=[]),
            ),
        ):
            resp = self._post()

        assert resp.status_code == 422

    def test_returns_409_if_already_exists(self):
        with patch("main.fs.v2_project_exists", return_value=True):
            resp = self._post()
        assert resp.status_code == 409

    def test_corrected_lines_override_parsed(self):
        from schemas import EstimateLine

        captured = {}

        def _fake_batch(**kwargs):
            captured["docs"] = kwargs.get("cost_code_docs", [])

        with (
            patch("main.fs.v2_project_exists", return_value=False),
            patch(
                "main.EstimateParser.parse",
                return_value=[EstimateLine(cost_code="3600", final_cost=32000.0)],
            ),
            patch("main.gcs.upload_estimate_pdf", return_value="gs://bucket/path"),
            patch(
                "main.gcs.check_dxf_present",
                return_value={"dxf_present": False, "dxf_gcs_path": None},
            ),
            patch(
                "main.fs.get_all_cost_codes_map", return_value=_mock_cost_codes_map()
            ),
            patch("main.fs.create_v2_project_batch", side_effect=_fake_batch),
        ):
            resp = self._post(
                corrected_lines=json.dumps(
                    [{"cost_code": "3600", "final_cost": 99999.0}]
                )
            )

        assert resp.status_code == 201
        doc_3600 = next(d for d in captured["docs"] if d["cost_code"] == "3600")
        assert doc_3600["estimate_final_cost"] == 99999.0
