"""
FCC filing PDF parser — extracts structured buy data from political ad filing PDFs.

Uses pypdf for text extraction, then Claude for structured data extraction.
"""

import json
import logging
import re

import anthropic
from pypdf import PdfReader
from io import BytesIO

logger = logging.getLogger(__name__)

client = anthropic.Anthropic()

SYSTEM_PROMPT = """You are an FCC political ad filing extraction engine. You receive text extracted from an FCC political file PDF.

STEP 1 — CLASSIFY THE DOCUMENT TYPE:
- "CONTRACT" or "ORDER": A buy order or booking confirmation. Has "Contract", "Order", "Estimate" in header. Shows future flight dates and ordered spots/dollars.
- "INVOICE": A post-air reconciliation. Has "Invoice" in header. Shows "Aired Spots", actual air dates/times, billing amounts. These are backward-looking.
- "NAB_FORM": A political advertising disclosure form (NAB form). Has candidate info, treasurer, election date.
- "OTHER": Rate cards, correspondence, amendments, or anything else.

Set document_type in your response. Only extract dollar amounts and flight dates from CONTRACT/ORDER documents. For INVOICE, NAB_FORM, and OTHER, set total_dollars and flight dates to null.

STEP 2 — EXTRACT DATA (for CONTRACT/ORDER only):

CRITICAL EXTRACTION RULES:

1. FLIGHT DATES: Look for "Contract Dates" at the top of the document. This is the authoritative flight date range (e.g., "04/07/26 - 04/13/26"). Do NOT use individual line item dates — they are the same as contract dates. Convert to YYYY-MM-DD (use 2026 for "26", 2025 for "25", etc.).

2. TOTAL DOLLARS: Look for the "Totals" line at the very end of the line items. It shows total spots and total gross dollars (e.g., "Totals 159 $96,650.00"). Use this EXACT figure. Do NOT sum individual lines yourself — use the printed total.

3. ESTIMATE NUMBER: Look for "Estimate #" in the header (e.g., "Estimate # 13348").

4. CONTRACT/REVISION NUMBER: Look for "Contract / Revision" (e.g., "1730658").

5. STATION: The station call sign appears at the top and on each line item (e.g., "WTTG").

6. ADVERTISER: Look for "Advertiser" field or the name next to it (e.g., "David Trone for Maryland").

7. AGENCY: Look for agency name and address block (e.g., "Canal Partners Media, LLC").

8. SPOTS: Use the total from the Totals line, not a count of lines.

9. NET vs GROSS: If there's a commission shown, calculate net = gross - commission. Otherwise set net_dollars to null.

Return valid JSON:
{
  "document_type": "CONTRACT",
  "advertiser_name": "David Trone for Maryland",
  "estimate_number": "13348",
  "contract_number": "1730658",
  "agency": "Canal Partners Media, LLC",
  "flight_start": "2026-04-07",
  "flight_end": "2026-04-13",
  "station": "WTTG",
  "market": null,
  "spot_length": 30,
  "total_dollars": 96650.00,
  "net_dollars": null,
  "spots_count": 159,
  "contact_info": {
    "name": "Abby Cronkite",
    "title": "Account Executive",
    "email": null,
    "phone": null
  },
  "party": "Democrat",
  "office": "US House",
  "confidence": 0.95,
  "line_items": [
    {"line": 1, "daypart": "Morning News 7a-730a", "time": "7a-730a", "days": "M-F", "spots": 5, "rate": 900.00, "amount": 4500.00, "length": 30},
    {"line": 2, "daypart": "Fox 5 News @ 10pm", "time": "10p-1030p", "spots": 4, "rate": 1200.00, "amount": 4800.00, "length": 30}
  ]
}

For CONTRACT/ORDER documents, extract ALL line items with daypart, time slot, days of week, spot count, per-spot rate, line total, and spot length.
For INVOICE/NAB_FORM/OTHER, set line_items to [].

Rules:
- Use EXACT figures from the document. Do not estimate or approximate.
- Dates must be YYYY-MM-DD format. "04/07/26" = "2026-04-07".
- Dollar amounts must be numeric (no $ signs, no commas).
- For party/office: infer from context if possible (e.g., "(D)" = Democrat, "for Senate" = US Senate). Use null if unclear.
- If the PDF text is garbled or mostly unreadable, set confidence below 0.3.
- If you can extract some but not all fields, return what you have with appropriate confidence."""


def extract_pdf_text(pdf_bytes: bytes) -> str:
    """Extract text from a PDF using pypdf."""
    try:
        reader = PdfReader(BytesIO(pdf_bytes))
        pages = []
        for page in reader.pages:
            text = page.extract_text()
            if text:
                pages.append(text)
        full_text = "\n\n".join(pages)
        logger.info(f"Extracted {len(full_text)} chars from {len(reader.pages)} PDF pages")
        return full_text
    except Exception as e:
        logger.error(f"PDF text extraction failed: {e}")
        return ""


async def parse_filing_pdf(pdf_bytes: bytes) -> dict:
    """
    Parse an FCC filing PDF: extract text, then use Claude for structured extraction.
    Returns dict with filing data fields.
    """
    text = extract_pdf_text(pdf_bytes)

    if not text or len(text.strip()) < 50:
        logger.warning("PDF text extraction yielded too little text")
        return {"confidence": 0.0, "error": "No readable text in PDF"}

    try:
        response = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[
                {
                    "role": "user",
                    "content": f"Extract structured data from this FCC political ad filing:\n\n{text[:20000]}",
                }
            ],
        )
        content = response.content[0].text

        # Parse JSON from response (may be wrapped in markdown code block)
        match = re.search(r"```json?\s*([\s\S]*?)```", content)
        parsed = json.loads(match.group(1).strip() if match else content)

        logger.info(
            f"Filing parsed: advertiser={parsed.get('advertiser_name')}, "
            f"dollars={parsed.get('total_dollars')}, confidence={parsed.get('confidence')}"
        )
        return parsed

    except json.JSONDecodeError as e:
        logger.error(f"Filing parse JSON error: {e}")
        return {"confidence": 0.1, "error": f"JSON parse error: {e}", "raw_text": text[:500]}
    except Exception as e:
        logger.error(f"Filing parse error: {e}")
        return {"confidence": 0.0, "error": str(e)}
