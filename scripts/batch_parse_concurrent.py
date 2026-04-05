#!/usr/bin/env python3
"""
Concurrent batch PDF parser — 5 workers, newest first, 2026 only.
Polite: 1s delay per worker between requests to avoid hammering FCC.
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
from src.build_monitors import create_monitors_for_contract

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
log = logging.getLogger("batch_parse")

CONCURRENCY = 5
MAX_RETRIES = 2
DOWNLOAD_TIMEOUT = 90.0
COST_PER_PARSE = 0.02
BUDGET_LIMIT = 800.0


def _parse_date(val):
    if not val: return None
    if isinstance(val, date): return val
    try: return date.fromisoformat(str(val)[:10])
    except: return None


# Shared counters
stats = {
    "parsed": 0, "contracts": 0, "invoices": 0, "nab": 0, "other": 0,
    "skipped": 0, "errors": 0, "cost": 0.0,
}
stats_lock = asyncio.Lock()


async def process_filing(pool, client, row):
    """Process a single filing — download + parse + store."""
    rid = row['id']
    url = row['filing_url']
    spender = row['spender_name'] or 'Unknown'
    station = row['station_call_sign'] or '?'

    # Download with retry
    pdf_bytes = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = await client.get(url)
            if resp.status_code == 200 and len(resp.content) > 200:
                pdf_bytes = resp.content
                break
        except Exception:
            pass
        if attempt < MAX_RETRIES:
            await asyncio.sleep(2 ** attempt)

    async with pool.acquire() as conn:
        if not pdf_bytes:
            await conn.execute(
                "UPDATE radar_items SET pdf_parsed = TRUE, parsed_at = $1, document_type = 'DOWNLOAD_FAILED' WHERE id = $2",
                datetime.now(timezone.utc), rid
            )
            async with stats_lock:
                stats["skipped"] += 1
            return

        await conn.execute("UPDATE radar_items SET pdf_downloaded = TRUE WHERE id = $1", rid)

        try:
            parsed = await parse_filing_pdf(pdf_bytes)
            async with stats_lock:
                stats["cost"] += COST_PER_PARSE

            doc_type = parsed.get('document_type', 'OTHER')
            dollars = parsed.get('total_dollars')
            flight_start = parsed.get('flight_start')
            flight_end = parsed.get('flight_end')
            party = parsed.get('party')
            agency = parsed.get('agency')
            estimate = parsed.get('estimate_number')
            spots = parsed.get('spots_count')
            office = parsed.get('office')
            confidence = parsed.get('confidence', 0)

            if doc_type not in ('CONTRACT', 'ORDER'):
                dollars = None
                flight_start = None
                flight_end = None

            await conn.execute('''
                UPDATE radar_items SET
                    pdf_parsed = TRUE, parsed_at = $2, document_type = $3,
                    total_dollars = $4, flight_start = $5, flight_end = $6,
                    spender_type = COALESCE($7, spender_type),
                    notes = $8, parsed_data = $9::jsonb
                WHERE id = $1
            ''', rid, datetime.now(timezone.utc), doc_type,
                dollars, _parse_date(flight_start), _parse_date(flight_end),
                party,
                json.dumps({'agency': agency, 'estimate': estimate, 'spots': spots,
                            'office': office, 'confidence': confidence}),
                json.dumps(parsed),
            )

            async with stats_lock:
                stats["parsed"] += 1
                if doc_type in ('CONTRACT', 'ORDER'):
                    stats["contracts"] += 1
                    dollar_str = f"${dollars:,.2f}" if dollars else "no $"
                    log.info(f"  CONTRACT: {spender} @ {station} | {dollar_str}")
                elif doc_type == 'INVOICE':
                    stats["invoices"] += 1
                elif doc_type == 'NAB_FORM':
                    stats["nab"] += 1
                else:
                    stats["other"] += 1

        except Exception as e:
            await conn.execute(
                "UPDATE radar_items SET pdf_parsed = TRUE, parsed_at = $1, document_type = 'PARSE_ERROR' WHERE id = $2",
                datetime.now(timezone.utc), rid
            )
            async with stats_lock:
                stats["errors"] += 1

    # Polite delay per worker
    await asyncio.sleep(1.0)


async def worker(name, queue, pool, client):
    """Worker that pulls from the queue and processes filings."""
    while True:
        row = await queue.get()
        if row is None:
            queue.task_done()
            break
        try:
            await process_filing(pool, client, row)
        except Exception as e:
            log.error(f"Worker {name} error: {e}")
        queue.task_done()


async def main():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn or not os.environ.get("ANTHROPIC_API_KEY"):
        print("ERROR: Set DATABASE_URL and ANTHROPIC_API_KEY")
        sys.exit(1)

    pool = await asyncpg.create_pool(dsn=dsn, min_size=CONCURRENCY, max_size=CONCURRENCY + 2)

    log.info(f"=== BATCH PARSE START ({CONCURRENCY} workers) ===")

    async with httpx.AsyncClient(timeout=DOWNLOAD_TIMEOUT, follow_redirects=True) as client:
        queue = asyncio.Queue(maxsize=CONCURRENCY * 2)

        # Start workers
        workers = []
        for i in range(CONCURRENCY):
            w = asyncio.create_task(worker(f"w{i}", queue, pool, client))
            workers.append(w)

        batch_num = 0
        while True:
            if stats["cost"] >= BUDGET_LIMIT:
                log.info(f"Budget limit reached: ${stats['cost']:.2f}")
                break

            async with pool.acquire() as conn:
                rows = await conn.fetch('''
                    SELECT id, station_call_sign, spender_name, filing_url, detected_at
                    FROM radar_items
                    WHERE pdf_parsed = FALSE AND filing_url IS NOT NULL AND detected_at >= '2026-01-01'
                    ORDER BY detected_at DESC
                    LIMIT $1
                ''', CONCURRENCY * 10)

            if not rows:
                log.info("No more filings. Done!")
                break

            for row in rows:
                await queue.put(row)

            # Wait for this batch to drain
            await queue.join()
            batch_num += 1

            async with pool.acquire() as conn:
                remaining = await conn.fetchval(
                    "SELECT COUNT(*) FROM radar_items WHERE pdf_parsed = FALSE AND filing_url IS NOT NULL AND detected_at >= '2026-01-01'"
                )

            log.info(
                f"BATCH {batch_num}: {stats['parsed']} parsed | {stats['contracts']} contracts | "
                f"{stats['invoices']} inv | {stats['nab']} nab | {stats['other']} oth | "
                f"{stats['skipped']} skip | {stats['errors']} err | "
                f"${stats['cost']:.2f} | {remaining} left"
            )

        # Stop workers
        for _ in workers:
            await queue.put(None)
        await asyncio.gather(*workers)

    await pool.close()

    log.info(f"\n{'='*60}")
    log.info(f"COMPLETE: {stats['parsed']} parsed, {stats['contracts']} contracts, ${stats['cost']:.2f} spent")


if __name__ == "__main__":
    asyncio.run(main())
