import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from unittest.mock import MagicMock, patch

from fastapi import HTTPException

from airtable_client import AirtableClient


@pytest.fixture(autouse=True)
def set_env(monkeypatch):
    monkeypatch.setenv("AIRTABLE_API_TOKEN", "test-token-123")


def _mock_response(data: dict, status: int = 200) -> MagicMock:
    mock = MagicMock()
    mock.status_code = status
    mock.ok = status < 400
    mock.json.return_value = data
    mock.text = str(data)
    return mock


class TestGetContractSignedProjects:
    def test_returns_correct_shape(self):
        records = {
            "records": [
                {
                    "id": "rec001",
                    "fields": {
                        "Job Name": "701 Hill - Malesevic",
                        "Reference Home 1": ["recABC"],
                        "Reference Home 2": ["recDEF"],
                    },
                },
                {
                    "id": "rec002",
                    "fields": {
                        "Job Name": "500 Oak - Hartley",
                    },
                },
            ]
        }
        with patch(
            "airtable_client.requests.get", return_value=_mock_response(records)
        ):
            client = AirtableClient()
            result = client.get_contract_signed_projects()

        assert len(result) == 2
        assert result[0]["record_id"] == "rec001"
        assert result[0]["job_name"] == "701 Hill - Malesevic"
        assert result[0]["address"] == ""
        assert result[0]["reference_home_ids"] == ["recABC", "recDEF"]

    def test_skips_records_without_job_name(self):
        records = {
            "records": [
                {"id": "rec001", "fields": {}},
                {"id": "rec002", "fields": {"Job Name": "Valid Project"}},
            ]
        }
        with patch(
            "airtable_client.requests.get", return_value=_mock_response(records)
        ):
            client = AirtableClient()
            result = client.get_contract_signed_projects()

        assert len(result) == 1
        assert result[0]["job_name"] == "Valid Project"

    def test_paginates_through_all_records(self):
        page1 = {
            "records": [{"id": "rec001", "fields": {"Job Name": "Project A"}}],
            "offset": "page2token",
        }
        page2 = {
            "records": [{"id": "rec002", "fields": {"Job Name": "Project B"}}],
        }
        with patch(
            "airtable_client.requests.get",
            side_effect=[_mock_response(page1), _mock_response(page2)],
        ):
            client = AirtableClient()
            result = client.get_contract_signed_projects()

        assert len(result) == 2
        assert result[0]["record_id"] == "rec001"
        assert result[1]["record_id"] == "rec002"

    def test_raises_503_on_connection_error(self):
        import requests as req_lib

        with patch(
            "airtable_client.requests.get",
            side_effect=req_lib.exceptions.ConnectionError("refused"),
        ):
            client = AirtableClient()
            with pytest.raises(HTTPException) as exc_info:
                client.get_contract_signed_projects()
            assert exc_info.value.status_code == 503

    def test_raises_503_on_api_error(self):
        with patch(
            "airtable_client.requests.get", return_value=_mock_response({}, status=503)
        ):
            client = AirtableClient()
            with pytest.raises(HTTPException) as exc_info:
                client.get_contract_signed_projects()
            assert exc_info.value.status_code == 503

    def test_raises_401_on_invalid_token(self):
        with patch(
            "airtable_client.requests.get", return_value=_mock_response({}, status=401)
        ):
            client = AirtableClient()
            with pytest.raises(HTTPException) as exc_info:
                client.get_contract_signed_projects()
            assert exc_info.value.status_code == 401

    def test_raises_503_on_rate_limit(self):
        with patch(
            "airtable_client.requests.get", return_value=_mock_response({}, status=429)
        ):
            client = AirtableClient()
            with pytest.raises(HTTPException) as exc_info:
                client.get_contract_signed_projects()
            assert exc_info.value.status_code == 503


class TestGetEstimateLines:
    def test_returns_correct_shape(self):
        records = {
            "records": [
                {"id": "el001", "fields": {"Cost Code": "3600", "Final Cost": 32000.0}},
                {"id": "el002", "fields": {"Cost Code": "3700", "Final Cost": 44450.0}},
            ]
        }
        with patch(
            "airtable_client.requests.get", return_value=_mock_response(records)
        ):
            client = AirtableClient()
            result = client.get_estimate_lines("Bruce & Kim Radke")

        assert len(result) == 2
        assert result[0] == {"cost_code": "3600", "final_cost": 32000.0}
        assert result[1] == {"cost_code": "3700", "final_cost": 44450.0}

    def test_skips_blank_cost_codes(self):
        records = {
            "records": [
                {"id": "el001", "fields": {"Cost Code": "", "Final Cost": 1000.0}},
                {"id": "el002", "fields": {"Cost Code": "3600", "Final Cost": 5000.0}},
                {"id": "el003", "fields": {}},
            ]
        }
        with patch(
            "airtable_client.requests.get", return_value=_mock_response(records)
        ):
            client = AirtableClient()
            result = client.get_estimate_lines("Bruce & Kim Radke")

        assert len(result) == 1
        assert result[0]["cost_code"] == "3600"

    def test_handles_missing_final_cost(self):
        records = {
            "records": [
                {"id": "el001", "fields": {"Cost Code": "3800"}},
            ]
        }
        with patch(
            "airtable_client.requests.get", return_value=_mock_response(records)
        ):
            client = AirtableClient()
            result = client.get_estimate_lines("Bruce & Kim Radke")

        assert result[0]["final_cost"] == 0.0

    def test_handles_non_numeric_final_cost(self):
        records = {
            "records": [
                {"id": "el001", "fields": {"Cost Code": "3600", "Final Cost": "N/A"}},
            ]
        }
        with patch(
            "airtable_client.requests.get", return_value=_mock_response(records)
        ):
            client = AirtableClient()
            result = client.get_estimate_lines("Bruce & Kim Radke")

        assert result[0]["final_cost"] == 0.0
