import io
import re

import pdfplumber

from schemas import EstimateLine

# Configurable column detection — update header patterns if the PDF template changes.
# Column indices are fallbacks when header search fails.
PARSER_CONFIG = {
    "cost_code_header_patterns": ["cost code", "code", "cst cd", "cost\ncode"],
    "final_cost_header_patterns": [
        "final cost",
        "final\ncost",
        "total",
        "amount",
        "budget",
    ],
    "cost_code_column_index": 0,
    "final_cost_column_index": -1,  # negative = from end
    "min_rows_for_valid_table": 3,
}


class EstimateParseError(Exception):
    def __init__(self, message: str, raw_extraction: list[dict] | None = None):
        super().__init__(message)
        self.raw_extraction = raw_extraction or []


def _looks_like_cost_code(value: str) -> bool:
    """Cost codes match patterns like '3600', '4800', '10000O'."""
    return bool(re.match(r"^\d{4,5}[A-Z]?$", str(value).strip()))


def _parse_money(value: str) -> float | None:
    if not value:
        return None
    cleaned = re.sub(r"[$,\s]", "", str(value).strip())
    try:
        return float(cleaned)
    except ValueError:
        return None


class EstimateParser:
    def __init__(self, config: dict | None = None):
        self.config = {**PARSER_CONFIG, **(config or {})}

    def parse(self, pdf_bytes: bytes) -> list[EstimateLine]:
        """
        Parse a PDF estimate and return cost code / final cost pairs.

        Raises EstimateParseError if no cost codes can be identified.
        Zero-cost rows are excluded from the returned list.
        """
        raw_rows: list[dict] = []

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            for page in pdf.pages:
                for table in page.extract_tables() or []:
                    raw_rows.extend(self._process_table(table))

        if not raw_rows:
            raise EstimateParseError(
                "No cost estimate table found in the PDF. "
                "Expected a table with cost code and final cost columns.",
                raw_extraction=[],
            )

        valid = [
            r
            for r in raw_rows
            if r.get("cost_code") and r.get("final_cost") is not None
        ]

        if not valid:
            raise EstimateParseError(
                f"Found {len(raw_rows)} table rows but none matched the cost code pattern "
                "(4–5 digit numeric, e.g. '3600'). "
                "Check that the PDF contains the expected cost estimate table.",
                raw_extraction=[{"raw": r.get("raw_row", [])} for r in raw_rows],
            )

        return [
            EstimateLine(cost_code=r["cost_code"], final_cost=r["final_cost"])
            for r in valid
            if r["final_cost"] > 0
        ]

    def _process_table(self, table: list[list]) -> list[dict]:
        if not table or len(table) < self.config["min_rows_for_valid_table"]:
            return []

        header_row_idx, code_col, cost_col = self._find_columns(table)

        if code_col is None:
            code_col = self.config["cost_code_column_index"]
        if cost_col is None:
            n_cols = len(table[0]) if table else 1
            raw_idx = self.config["final_cost_column_index"]
            cost_col = n_cols + raw_idx if raw_idx < 0 else raw_idx

        rows = []
        for row in table[header_row_idx + 1 :]:
            if not row or len(row) <= max(code_col, cost_col):
                continue
            raw_code = str(row[code_col] or "").strip()
            raw_cost = str(row[cost_col] or "").strip()

            if not _looks_like_cost_code(raw_code):
                continue

            cost = _parse_money(raw_cost)
            rows.append(
                {
                    "cost_code": raw_code,
                    "final_cost": cost,
                    "raw_row": [str(c or "") for c in row],
                }
            )

        return rows

    def _find_columns(self, table: list[list]) -> tuple[int, int | None, int | None]:
        code_patterns = self.config["cost_code_header_patterns"]
        cost_patterns = self.config["final_cost_header_patterns"]

        for row_idx, row in enumerate(table[:5]):
            if not row:
                continue
            cells = [str(c or "").lower().strip() for c in row]

            code_col = next(
                (i for i, c in enumerate(cells) if any(p in c for p in code_patterns)),
                None,
            )
            cost_col = next(
                (i for i, c in enumerate(cells) if any(p in c for p in cost_patterns)),
                None,
            )

            if code_col is not None or cost_col is not None:
                return row_idx, code_col, cost_col

        return 0, None, None
