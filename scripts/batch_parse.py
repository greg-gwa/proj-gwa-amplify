#!/usr/bin/env python3
"""
Batch PDF parser — works backwards from newest, 2026 only.
Resilient: retries timeouts, skips failures, runs indefinitely.

Usage:
  DATABASE_URL=... ANTHROPIC_API_KEY=... nohup python3 -u scripts/batch_parse.py > /tmp/batch_parse.log 2>&1 &
"""

import asyncio
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timezone, date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "ingest"))

import asyncpg
import httpx

from src.parse_filing import parse_filing_pdf

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s: %(message)s",
)
log = logging.getLogger("batch_parse")

BATCH_SIZE = 50  # fetch this many at a time
MAX_DOWNLOAD_RETRIES = 3
DOWNLOAD_TIMEOUT = 120.0  # seconds
COST_PER_PARSE = 0.02
BUDGET_LIMIT = 800.0  # stop if we exceed this


def _parse_date(val):
    if not val:
        return None
    if isinstance(val, date):
        return val
    try:
        return date.fromisoformat(str(val)[:10])
    except (ValueError, TypeError):
        return None


async def download_pdf(client: httpx.AsyncClient, url: str) -> bytes | None:
    """Download PDF with retries."""
    for attempt in range(MAX_DOWNLOAD_RETRIES):
        try:
            resp = await client.get(url)
            if resp.status_code == 200 and len(resp.content) > 200:
                return resp.content
            log.warning(f"  Download attempt {attempt+1}: HTTP {resp.status_code}, {len(resp.content)} bytes")
        except Exception as e:
            log.warning(f"  Download attempt {attempt+1}: {e}")
        if attempt < MAX_DOWNLOAD_RETRIES - 1:
            await asyncio.sleep(2 ** attempt)  # exponential backoff: 1s, 2s, 4s
    return None


async def main():
    dsn = os.environ.get("DATABASE_URL")
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not dsn or not api_key:
        print("ERROR: Set DATABASE_URL and ANTHROPIC_API_KEY")
        sys.exit(1)

    conn = await asyncpg.connect(dsn=dsn)

    total_parsed = 0
    total_skipped = 0
    total_errors = 0
    total_cost = 0.0
    contracts_found = 0
    invoices_found = 0
    nab_forms_found = 0
    other_found = 0

    log.info("=== BATCH PARSE START ===")
    log.info("Processing 2026 filings, newest first")

    async with httpx.AsyncClient(timeout=DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
        while True:
            # Fetch next batch — newest unparsed 2026 filings
            rows = await conn.fetch('''
                SELECT r.id, r.station_call_sign, r.spender_name, r.filing_url, r.detected_at
                FROM radar_items r
                WHERE r.pdf_parsed = FALSE
                  AND r.filing_url IS NOT NULL
                  AND r.detected_at >= '2026-01-01'
                ORDER BY r.detected_at DESC
                LIMIT $1
            ''', BATCH_SIZE)

            if not rows:
                log.info("No more filings to parse. Done!")
                break

            if total_cost >= BUDGET_LIMIT:
                log.info(f"Budget limit reached: ${total_cost:.2f} >= ${BUDGET_LIMIT:.2f}. Stopping.")
                break

            log.info(f"Batch: {len(rows)} filings (oldest in batch: {rows[-1]['detected_at']})")

            for row in rows:
                rid = row['id']
                url = row['filing_url']
                spender = row['spender_name'] or 'Unknown'
                station = row['station_call_sign'] or '?'
                detected = row['detected_at']

                # Download
                pdf_bytes = await download_pdf(client, url)
                if not pdf_bytes:
                    log.warning(f"  SKIP (download failed): {spender} @ {station}")
                    # Mark as parsed with error so we don't retry forever
                    await conn.execute(
                        "UPDATE radar_items SET pdf_parsed = TRUE, parsed_at = $1, document_type = 'DOWNLOAD_FAILED' WHERE id = $2",
                        datetime.now(timezone.utc), rid
                    )
                    total_skipped += 1
                    continue

                await conn.execute("UPDATE radar_items SET pdf_downloaded = TRUE WHERE id = $1", rid)

                # Parse with Claude
                try:
                    parsed = await parse_filing_pdf(pdf_bytes)
                    total_cost += COST_PER_PARSE

                    doc_type = parsed.get('document_type', 'OTHER')
                    dollars = parsed.get('total_dollars')
                    flight_start = parsed.get('flight_start')
                    flight_end = parsed.get('flight_end')
                    agency = parsed.get('agency')
                    estimate = parsed.get('estimate_number')
                    spots = parsed.get('spots_count')
                    party = parsed.get('party')
                    office = parsed.get('office')
                    confidence = parsed.get('confidence', 0)

                    # Only store dollars/dates for contracts
                    if doc_type not in ('CONTRACT', 'ORDER'):
                        dollars = None
                        flight_start = None
                        flight_end = None

                    await conn.execute('''
                        UPDATE radar_items SET
                            pdf_parsed = TRUE, parsed_at = $2, document_type = $3,
                            total_dollars = $4, flight_start = $5, flight_end = $6,
                            spender_type = COALESCE($7, spender_type),
                            notes = $8,
                            parsed_data = $9::jsonb
                        WHERE id = $1
                    ''', rid, datetime.now(timezone.utc), doc_type,
                        dollars,
                        _parse_date(flight_start),
                        _parse_date(flight_end),
                        party,
                        json.dumps({'agency': agency, 'estimate': estimate, 'spots': spots,
                                    'office': office, 'confidence': confidence}),
                        json.dumps(parsed),
                    )

                    total_parsed += 1
                    if doc_type in ('CONTRACT', 'ORDER'):
                        contracts_found += 1
                        dollar_str = f"${dollars:,.2f}" if dollars else "no $"
                        log.info(f"  CONTRACT: {spender} @ {station} | {dollar_str} | {flight_start}→{flight_end}")
                    elif doc_type == 'INVOICE':
                        invoices_found += 1
                    elif doc_type == 'NAB_FORM':
                        nab_forms_found += 1
                    else:
                        other_found += 1

                except Exception as e:
                    log.error(f"  PARSE ERROR: {spender} @ {station}: {e}")
                    await conn.execute(
                        "UPDATE radar_items SET pdf_parsed = TRUE, parsed_at = $1, document_type = 'PARSE_ERROR' WHERE id = $2",
                        datetime.now(timezone.utc), rid
                    )
                    total_errors += 1

                # Small delay between parses
                await asyncio.sleep(0.5)

            # Progress report every batch
            remaining = await conn.fetchval(
                "SELECT COUNT(*) FROM radar_items WHERE pdf_parsed = FALSE AND filing_url IS NOT NULL AND detected_at >= '2026-01-01'"
            )
            log.info(
                f"PROGRESS: {total_parsed} parsed | {contracts_found} contracts | "
                f"{invoices_found} invoices | {nab_forms_found} NAB | {other_found} other | "
                f"{total_skipped} skipped | {total_errors} errors | "
                f"${total_cost:.2f} spent | {remaining} remaining"
            )

    log.info(f"\n{'='*60}")
    log.info(f"BATCH PARSE COMPLETE")
    log.info(f"{'='*60}")
    log.info(f"Total parsed:    {total_parsed}")
    log.info(f"  Contracts:     {contracts_found}")
    log.info(f"  Invoices:      {invoices_found}")
    log.info(f"  NAB Forms:     {nab_forms_found}")
    log.info(f"  Other:         {other_found}")
    log.info(f"Skipped:         {total_skipped}")
    log.info(f"Errors:          {total_errors}")
    log.info(f"Total cost:      ${total_cost:.2f}")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
