import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from estimate_parser import EstimateParser, EstimateParseError


def _make_pdf_mock(tables_per_page: list[list[list]]) -> MagicMock:
    """Build a mock pdfplumber PDF with one page per tables_per_page entry."""
    pages = []
    for tables in tables_per_page:
        page = MagicMock()
        page.extract_tables.return_value = tables
        pages.append(page)

    pdf = MagicMock()
    pdf.__enter__ = MagicMock(return_value=pdf)
    pdf.__exit__ = MagicMock(return_value=False)
    pdf.pages = pages
    return pdf


class TestParse:
    def test_returns_correct_cost_code_final_cost_pairs(self):
        table = [
            ["Cost Code", "Description", "Final Cost"],
            ["3600", "Plumbing Rough", "32000"],
            ["3700", "HVAC", "44450.50"],
            ["4200", "Landscaping", "$18,500.00"],
        ]
        mock_pdf = _make_pdf_mock([[table]])

        with patch("estimate_parser.pdfplumber.open", return_value=mock_pdf):
            result = EstimateParser().parse(b"fake")

        assert len(result) == 3
        assert result[0].cost_code == "3600"
        assert result[0].final_cost == 32000.0
        assert result[1].cost_code == "3700"
        assert result[1].final_cost == 44450.5
        assert result[2].final_cost == 18500.0

    def test_excludes_zero_cost_rows(self):
        table = [
            ["Cost Code", "Description", "Final Cost"],
            ["3600", "Plumbing", "32000"],
            ["3800", "Electrical", "0"],
            ["3900", "Lighting", ""],
        ]
        mock_pdf = _make_pdf_mock([[table]])

        with patch("estimate_parser.pdfplumber.open", return_value=mock_pdf):
            result = EstimateParser().parse(b"fake")

        assert len(result) == 1
        assert result[0].cost_code == "3600"

    def test_raises_parse_error_when_no_tables(self):
        mock_pdf = _make_pdf_mock([[]])  # page with no tables

        with patch("estimate_parser.pdfplumber.open", return_value=mock_pdf):
            with pytest.raises(EstimateParseError):
                EstimateParser().parse(b"fake")

    def test_raises_parse_error_when_no_cost_code_matches(self):
        table = [
            ["Item", "Description", "Price"],
            ["Widget A", "Some item", "100"],
            ["Widget B", "Another", "200"],
            ["Widget C", "Third", "300"],
        ]
        mock_pdf = _make_pdf_mock([[table]])

        with patch("estimate_parser.pdfplumber.open", return_value=mock_pdf):
            with pytest.raises(EstimateParseError) as exc_info:
                EstimateParser().parse(b"fake")

        assert exc_info.value.raw_extraction is not None

    def test_combines_tables_across_pages(self):
        page1_table = [
            ["Cost Code", "Description", "Final Cost"],
            ["3600", "Plumbing", "32000"],
            ["3601", "Plumbing Trim", "8000"],
        ]
        page2_table = [
            ["Cost Code", "Description", "Final Cost"],
            ["3700", "HVAC", "44450"],
            ["3701", "HVAC Trim", "5000"],
        ]
        mock_pdf = _make_pdf_mock([[page1_table], [page2_table]])

        with patch("estimate_parser.pdfplumber.open", return_value=mock_pdf):
            result = EstimateParser().parse(b"fake")

        assert len(result) == 4

    def test_handles_dollar_sign_and_commas(self):
        table = [
            ["Cost Code", "Name", "Final Cost"],
            ["1300", "Framing", "$245,000.00"],
            ["1400", "Sheathing", "$18,000.00"],
        ]
        mock_pdf = _make_pdf_mock([[table]])

        with patch("estimate_parser.pdfplumber.open", return_value=mock_pdf):
            result = EstimateParser().parse(b"fake")

        assert result[0].final_cost == 245000.0

    def test_skips_small_tables(self):
        small_table = [["Code", "Cost"], ["3600", "1000"]]  # only 2 rows — below min
        valid_table = [
            ["Cost Code", "Name", "Final Cost"],
            ["3600", "Plumbing", "32000"],
            ["3700", "HVAC", "44000"],
        ]
        mock_pdf = _make_pdf_mock([[small_table, valid_table]])

        with patch("estimate_parser.pdfplumber.open", return_value=mock_pdf):
            result = EstimateParser().parse(b"fake")

        # Small table skipped; valid table found
        assert len(result) == 2
