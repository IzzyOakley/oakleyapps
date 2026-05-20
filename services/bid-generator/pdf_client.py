import io
import os
import datetime
from google.cloud import storage

BUCKET_NAME = os.environ.get("GCS_BUCKET", "oakley-documents")
GCS_PROJECT = os.environ.get("GCS_PROJECT", "buildertrend-pipeline")

_client = None


def get_client():
    global _client
    if _client is None:
        _client = storage.Client(project=GCS_PROJECT)
    return _client


def generate_bid_pdf(bid: dict, project: dict, version: int = 1) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import (
        SimpleDocTemplate,
        Table,
        TableStyle,
        Paragraph,
        Spacer,
        HRFlowable,
        KeepTogether,
    )

    NAVY = colors.HexColor("#1a2744")
    MID_GRAY = colors.HexColor("#6b7280")
    LIGHT_GRAY = colors.HexColor("#e5e7eb")
    PALE = colors.HexColor("#f9fafb")
    WHITE = colors.white

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        topMargin=0.6 * inch,
        bottomMargin=0.75 * inch,
        leftMargin=0.75 * inch,
        rightMargin=0.75 * inch,
    )
    story = []

    # ── Header band ───────────────────────────────────────────────────────────
    # Two-column header: company on left, doc meta on right
    today = datetime.date.today()
    doc_id = bid.get("bid_id", "")[:8].upper()

    header_data = [
        [
            Paragraph(
                "OAKLEY HOME BUILDERS",
                ParagraphStyle(
                    "co",
                    fontName="Helvetica-Bold",
                    fontSize=15,
                    textColor=NAVY,
                    leading=18,
                ),
            ),
            Paragraph(
                f"<font size='8' color='#6b7280'>BID REQUEST &nbsp;·&nbsp; "
                f"v{version} &nbsp;·&nbsp; {today.strftime('%B %d, %Y')}<br/>"
                f"<font color='#9ca3af'>Doc ID: {doc_id}</font></font>",
                ParagraphStyle(
                    "meta",
                    fontName="Helvetica",
                    fontSize=8,
                    textColor=MID_GRAY,
                    leading=12,
                    alignment=2,
                ),
            ),
        ]
    ]
    header_table = Table(header_data, colWidths=[4.0 * inch, 3.0 * inch])
    header_table.setStyle(
        TableStyle(
            [
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ]
        )
    )
    story.append(header_table)
    story.append(Spacer(1, 6))
    story.append(HRFlowable(width="100%", thickness=2, color=NAVY))
    story.append(Spacer(1, 12))

    # ── Vendor block ──────────────────────────────────────────────────────────
    vendor_name = bid.get("vendor_name") or "—"
    story.append(
        Paragraph(
            "VENDOR",
            ParagraphStyle(
                "lbl",
                fontName="Helvetica",
                fontSize=7,
                textColor=MID_GRAY,
                spaceAfter=2,
                letterSpacing=1,
            ),
        )
    )
    story.append(
        Paragraph(
            vendor_name,
            ParagraphStyle(
                "vendor",
                fontName="Helvetica-Bold",
                fontSize=14,
                textColor=NAVY,
                spaceAfter=2,
            ),
        )
    )
    story.append(Spacer(1, 10))

    # ── Project info table ────────────────────────────────────────────────────
    address = project.get("address") or bid.get("project_name") or "—"
    info_data = [
        [
            "Project",
            bid.get("project_name") or "—",
            "Cost Code",
            f"{bid.get('cost_code', '')} — {bid.get('cost_code_name', '')}",
        ],
        [
            "Address",
            address,
            "Status",
            (bid.get("status") or "—").replace("_", " ").title(),
        ],
    ]
    info_table = Table(
        info_data, colWidths=[0.85 * inch, 2.65 * inch, 0.85 * inch, 2.65 * inch]
    )
    info_table.setStyle(
        TableStyle(
            [
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("TEXTCOLOR", (0, 0), (0, -1), MID_GRAY),
                ("TEXTCOLOR", (2, 0), (2, -1), MID_GRAY),
                ("TEXTCOLOR", (1, 0), (1, -1), NAVY),
                ("TEXTCOLOR", (3, 0), (3, -1), NAVY),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("BACKGROUND", (0, 0), (-1, -1), PALE),
                ("BOX", (0, 0), (-1, -1), 0.5, LIGHT_GRAY),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, LIGHT_GRAY),
            ]
        )
    )
    story.append(info_table)
    story.append(Spacer(1, 16))

    # ── Line items ────────────────────────────────────────────────────────────
    story.append(
        Paragraph(
            "LINE ITEMS",
            ParagraphStyle(
                "section",
                fontName="Helvetica-Bold",
                fontSize=8,
                textColor=MID_GRAY,
                spaceAfter=6,
                letterSpacing=1,
            ),
        )
    )

    col_headers = ["Description", "Qty", "Unit", "Unit Price", "Total", "Source"]
    table_data = [col_headers]
    for item in bid.get("line_items", []):
        qty = item.get("quantity")
        up = item.get("unit_price")
        total = item.get("total")
        source = (item.get("source") or "").replace("_", " ").title()
        table_data.append(
            [
                Paragraph(
                    item.get("description", ""),
                    ParagraphStyle(
                        "cell", fontName="Helvetica", fontSize=8, leading=10
                    ),
                ),
                f"{qty:,.0f}" if qty is not None else "—",
                item.get("unit", ""),
                f"${up:,.2f}" if up is not None else "—",
                f"${total:,.2f}" if total is not None else "—",
                source,
            ]
        )

    subtotal = bid.get("subtotal")
    table_data.append(
        [
            Paragraph(
                "<b>SUBTOTAL</b>",
                ParagraphStyle(
                    "sub", fontName="Helvetica-Bold", fontSize=8, leading=10
                ),
            ),
            "",
            "",
            "",
            Paragraph(
                f"<b>${subtotal:,.2f}</b>" if subtotal is not None else "<b>—</b>",
                ParagraphStyle(
                    "subamt",
                    fontName="Helvetica-Bold",
                    fontSize=8,
                    leading=10,
                    alignment=2,
                ),
            ),
            "",
        ]
    )

    col_widths = [
        2.9 * inch,
        0.55 * inch,
        0.55 * inch,
        0.85 * inch,
        0.85 * inch,
        0.8 * inch,
    ]
    t = Table(table_data, colWidths=col_widths, repeatRows=1)
    row_count = len(table_data)
    t.setStyle(
        TableStyle(
            [
                # Header row
                ("BACKGROUND", (0, 0), (-1, 0), NAVY),
                ("TEXTCOLOR", (0, 0), (-1, 0), WHITE),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, 0), 8),
                ("TOPPADDING", (0, 0), (-1, 0), 5),
                ("BOTTOMPADDING", (0, 0), (-1, 0), 5),
                # Data rows
                ("FONTSIZE", (0, 1), (-1, -1), 8),
                ("TOPPADDING", (0, 1), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 1), (-1, -1), 4),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                # Alignment
                ("ALIGN", (1, 0), (4, -1), "RIGHT"),
                ("ALIGN", (0, 0), (0, -1), "LEFT"),
                ("ALIGN", (5, 0), (5, -1), "CENTER"),
                # Zebra rows
                ("ROWBACKGROUNDS", (0, 1), (-1, row_count - 2), [WHITE, PALE]),
                # Subtotal row
                ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#f0f4ff")),
                ("LINEABOVE", (0, -1), (-1, -1), 1, NAVY),
                # Grid
                ("LINEBELOW", (0, 0), (-1, -2), 0.25, LIGHT_GRAY),
                ("BOX", (0, 0), (-1, -1), 0.5, LIGHT_GRAY),
            ]
        )
    )
    story.append(KeepTogether([t]))

    # ── Generation notes ──────────────────────────────────────────────────────
    gen_notes = bid.get("generation_notes")
    if gen_notes:
        story.append(Spacer(1, 12))
        story.append(
            Paragraph(
                "PRICING NOTES",
                ParagraphStyle(
                    "nlbl",
                    fontName="Helvetica-Bold",
                    fontSize=7,
                    textColor=MID_GRAY,
                    spaceAfter=4,
                    letterSpacing=1,
                ),
            )
        )
        story.append(
            Paragraph(
                gen_notes,
                ParagraphStyle(
                    "notes",
                    fontName="Helvetica",
                    fontSize=8,
                    textColor=colors.HexColor("#374151"),
                    leading=11,
                    borderPad=6,
                    backColor=colors.HexColor("#fffbeb"),
                    borderColor=colors.HexColor("#fcd34d"),
                    borderWidth=0.5,
                    borderRadius=3,
                ),
            )
        )

    # ── Footer ────────────────────────────────────────────────────────────────
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=0.5, color=LIGHT_GRAY))
    story.append(Spacer(1, 8))
    story.append(
        Paragraph(
            f"Prepared by Oakley Home Builders on {today.strftime('%B %d, %Y')} "
            f"(Document v{version} · Ref: {doc_id}). "
            "Please review all quantities, confirm scope, and return signed.",
            ParagraphStyle(
                "footer",
                fontName="Helvetica",
                fontSize=7,
                textColor=MID_GRAY,
                leading=10,
            ),
        )
    )
    story.append(Spacer(1, 14))
    sig_t = Table(
        [
            [
                "Vendor signature: ______________________________",
                "Date: ________________",
            ]
        ],
        colWidths=[4.5 * inch, 2.5 * inch],
    )
    sig_t.setStyle(
        TableStyle(
            [
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("FONTNAME", (0, 0), (-1, -1), "Helvetica"),
                ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#374151")),
                ("ALIGN", (1, 0), (1, 0), "RIGHT"),
            ]
        )
    )
    story.append(sig_t)

    doc.build(story)
    return buffer.getvalue()


def upload_bid_pdf(project_id, vendor_id, cost_code, pdf_bytes) -> str:
    client = get_client()
    bucket = client.bucket(BUCKET_NAME)
    date_str = datetime.date.today().strftime("%Y%m%d")
    gcs_path = f"projects/{project_id}/bids/{vendor_id}/{cost_code}_{date_str}.pdf"
    blob = bucket.blob(gcs_path)
    blob.upload_from_string(pdf_bytes, content_type="application/pdf")
    return gcs_path
