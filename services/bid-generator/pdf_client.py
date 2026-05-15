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


def generate_bid_pdf(bid: dict, project: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import inch
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, HRFlowable

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=letter,
                            topMargin=0.75*inch, bottomMargin=0.75*inch,
                            leftMargin=0.75*inch, rightMargin=0.75*inch)
    styles = getSampleStyleSheet()
    story = []

    story.append(Paragraph("OAKLEY HOME BUILDERS",
                            ParagraphStyle("h1", parent=styles["Heading1"], fontSize=16, spaceAfter=4)))
    story.append(Paragraph(f"Bid Request — {bid.get('vendor_name', '')}",
                            ParagraphStyle("sub", parent=styles["Normal"], fontSize=10,
                                           textColor=colors.HexColor("#666666"), spaceAfter=2)))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"Project: {bid.get('project_name', '')}  |  {project.get('address', '')}",
                            ParagraphStyle("label", parent=styles["Normal"], fontSize=10, spaceAfter=2)))
    story.append(Paragraph(f"Date: {datetime.date.today().strftime('%B %d, %Y')}",
                            ParagraphStyle("label2", parent=styles["Normal"], fontSize=10, spaceAfter=2)))
    story.append(Paragraph(f"Cost Code: {bid.get('cost_code', '')} — {bid.get('cost_code_name', '')}",
                            ParagraphStyle("label3", parent=styles["Normal"], fontSize=10, spaceAfter=2)))
    story.append(Spacer(1, 12))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#cccccc")))
    story.append(Spacer(1, 8))
    story.append(Paragraph("LINE ITEMS",
                            ParagraphStyle("section", parent=styles["Heading3"], fontSize=11, spaceAfter=6)))

    col_headers = ["Description", "Qty", "Unit", "Unit Price", "Total"]
    table_data = [col_headers]
    for item in bid.get("line_items", []):
        up = item.get("unit_price")
        total = item.get("total")
        table_data.append([
            item.get("description", ""),
            f"{item.get('quantity', ''):.0f}" if item.get("quantity") is not None else "—",
            item.get("unit", ""),
            f"${up:,.2f}" if up is not None else "—",
            f"${total:,.2f}" if total is not None else "—",
        ])
    subtotal = bid.get("subtotal")
    table_data.append(["", "", "", "SUBTOTAL:", f"${subtotal:,.2f}" if subtotal is not None else "—"])

    col_widths = [3.2*inch, 0.7*inch, 0.6*inch, 1.0*inch, 1.0*inch]
    t = Table(table_data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,0), colors.HexColor("#f0f0f0")),
        ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"),
        ("FONTSIZE", (0,0), (-1,-1), 9),
        ("ALIGN", (1,0), (-1,-1), "RIGHT"),
        ("ALIGN", (0,0), (0,-1), "LEFT"),
        ("LINEBELOW", (0,0), (-1,0), 0.5, colors.HexColor("#cccccc")),
        ("LINEABOVE", (0,-1), (-1,-1), 0.5, colors.HexColor("#cccccc")),
        ("FONTNAME", (3,-1), (-1,-1), "Helvetica-Bold"),
        ("TOPPADDING", (0,0), (-1,-1), 4),
        ("BOTTOMPADDING", (0,0), (-1,-1), 4),
        ("ROWBACKGROUNDS", (0,1), (-1,-2), [colors.white, colors.HexColor("#fafafa")]),
    ]))
    story.append(t)

    gen_notes = bid.get("generation_notes")
    if gen_notes:
        story.append(Spacer(1, 12))
        story.append(Paragraph(f"Notes: {gen_notes}",
                                ParagraphStyle("notes", parent=styles["Normal"], fontSize=8,
                                               textColor=colors.HexColor("#888888"))))

    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#cccccc")))
    story.append(Spacer(1, 8))
    story.append(Paragraph(
        f"This bid was prepared by Oakley Home Builders based on project plans dated "
        f"{datetime.date.today().strftime('%B %d, %Y')}. "
        "Please review, confirm quantities, and return signed.",
        ParagraphStyle("footer", parent=styles["Normal"], fontSize=8, textColor=colors.HexColor("#666666"))))
    story.append(Spacer(1, 16))
    sig_t = Table([["Vendor signature: ________________", "Date: ________"]], colWidths=[4.5*inch, 2.0*inch])
    sig_t.setStyle(TableStyle([("FONTSIZE", (0,0), (-1,-1), 9), ("ALIGN", (1,0), (1,0), "RIGHT")]))
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


def get_pdf_signed_url(gcs_path) -> str:
    client = get_client()
    blob = client.bucket(BUCKET_NAME).blob(gcs_path)
    return blob.generate_signed_url(
        expiration=datetime.timedelta(hours=1), method="GET", version="v4")
