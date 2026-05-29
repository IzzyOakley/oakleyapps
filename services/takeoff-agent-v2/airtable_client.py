import os

import requests
from fastapi import HTTPException

# Airtable base for Oakley's Parametric Home Specification System
AIRTABLE_BASE_ID = "app8HFkU9NCaCrzu3"
AIRTABLE_NEW_HOMES_TABLE = "New%20Homes"
AIRTABLE_ESTIMATE_LINES_TABLE = "Estimated%20Cost%20Lines"
AIRTABLE_API_URL = "https://api.airtable.com/v0"


class AirtableClient:
    def __init__(self) -> None:
        token = os.environ.get("AIRTABLE_API_TOKEN")
        if not token:
            raise HTTPException(
                status_code=503, detail="AIRTABLE_API_TOKEN not configured"
            )
        self._headers = {
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        }

    def _get(self, table: str, params: dict | None = None) -> list[dict]:
        """Paginate through all records for a table, returning list of raw record dicts."""
        url = f"{AIRTABLE_API_URL}/{AIRTABLE_BASE_ID}/{table}"
        records: list[dict] = []
        offset: str | None = None

        while True:
            req_params = dict(params or {})
            if offset:
                req_params["offset"] = offset

            try:
                resp = requests.get(
                    url, headers=self._headers, params=req_params, timeout=15
                )
            except requests.exceptions.ConnectionError as exc:
                raise HTTPException(
                    status_code=503, detail=f"Airtable unreachable: {exc}"
                ) from exc
            except requests.exceptions.Timeout as exc:
                raise HTTPException(
                    status_code=503, detail="Airtable request timed out"
                ) from exc

            if resp.status_code == 401:
                raise HTTPException(
                    status_code=401, detail="Airtable API token is invalid or expired"
                )
            if resp.status_code == 429:
                raise HTTPException(
                    status_code=503, detail="Airtable rate limit exceeded — retry later"
                )
            if not resp.ok:
                raise HTTPException(
                    status_code=503,
                    detail=f"Airtable API error: {resp.status_code} {resp.text[:200]}",
                )

            body = resp.json()
            records.extend(body.get("records", []))

            offset = body.get("offset")
            if not offset:
                break

        return records

    def get_contract_signed_projects(self) -> list[dict]:
        """Fetch New Homes records where Prelim Proposal Status = 'Contract Signed'."""
        records = self._get(
            AIRTABLE_NEW_HOMES_TABLE,
            params={
                "filterByFormula": "{Prelim Proposal Status}='Contract Signed'",
                "fields[]": ["Job Name", "Address", "Reference Homes"],
            },
        )

        result = []
        for r in records:
            fields = r.get("fields", {})
            # Airtable may use "Job Name" or "Name" depending on table config
            job_name = (fields.get("Job Name") or fields.get("Name") or "").strip()
            if not job_name:
                continue
            result.append(
                {
                    "record_id": r["id"],
                    "job_name": job_name,
                    "address": fields.get("Address", ""),
                    "reference_home_ids": fields.get("Reference Homes") or [],
                }
            )
        return result

    def get_estimate_lines(self, record_id: str) -> list[dict]:
        """Fetch Estimated Cost Lines linked to a job record_id."""
        records = self._get(
            AIRTABLE_ESTIMATE_LINES_TABLE,
            params={
                "filterByFormula": f"FIND('{record_id}', ARRAYJOIN({{Job}}))",
                "fields[]": ["Cost Code", "Final Cost"],
            },
        )

        result = []
        for r in records:
            fields = r.get("fields", {})
            cost_code = str(fields.get("Cost Code", "")).strip()
            if not cost_code:
                continue
            try:
                final_cost = float(fields.get("Final Cost") or 0)
            except (TypeError, ValueError):
                final_cost = 0.0
            result.append({"cost_code": cost_code, "final_cost": final_cost})
        return result
