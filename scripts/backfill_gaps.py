#!/usr/bin/env python3
"""
Backfill missing station filings — re-scans stations that are in the stations
table but have zero radar_items. Retries with longer timeouts.
"""

import asyncio
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "ingest"))

import asyncpg
import httpx

from src.fcc_client import parse_folder_path, parse_fcc_timestamp

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("backfill_gaps")

FCC_BASE = "https://publicfiles.fcc.gov/api"
LOOKBACK_DAYS = 730


async def main():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: Set DATABASE_URL")
        sys.exit(1)

    conn = await asyncpg.connect(dsn=dsn)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=LOOKBACK_DAYS)

    # Find stations we know about but have no filings for
    gaps = await conn.fetch("""
        SELECT DISTINCT s.call_sign, s.network, s.market_name
        FROM stations s
        LEFT JOIN radar_items r ON r.station_call_sign = s.call_sign
        WHERE r.id IS NULL
          AND s.call_sign IS NOT NULL
          AND s.call_sign != ''
        ORDER BY s.call_sign
    """)

    logger.info(f"Found {len(gaps)} stations with zero filings — re-scanning with 3-minute timeout")

    total_new = 0
    total_found = 0
    filled = 0
    batch_rows = []

    async with httpx.AsyncClient(
        headers={"Accept": "application/json"},
        follow_redirects=True,
        timeout=300.0,  # 5 minute timeout
    ) as client:
        for i, gap in enumerate(gaps):
            call_sign = gap["call_sign"]
            market = gap["market_name"] or ""

            # Look up entity ID
            import re
            clean = re.sub(r'-(TV|FM|AM|DT|LP|CA|CD)$', '', call_sign.upper()).strip()
            try:
                resp = await client.get(f"{FCC_BASE}/service/tv/facility/search/{clean}")
                if resp.status_code != 200:
                    continue
                data = resp.json()
                entity_id = None
                for entry in data.get("results", {}).get("searchList", []):
                    for fac in entry.get("facilityList", []):
                        entity_id = str(fac.get("id", ""))
                        if entity_id:
                            break
                    if entity_id:
                        break
                if not entity_id:
                    continue
            except Exception as e:
                logger.warning(f"  {call_sign}: station lookup failed: {e}")
                continue

            # Get filings
            try:
                resp = await client.get(
                    f"{FCC_BASE}/manager/search/key/Political File.json",
                    params={"entityId": entity_id, "limit": 500},
                )
                if resp.status_code != 200:
                    continue
                data = resp.json()
                files = data.get("searchResult", {}).get("files", []) if isinstance(data, dict) else []
            except Exception as e:
                logger.warning(f"  {call_sign}: filings query failed: {e}")
                continue

            station_filings = 0
            for item in files:
                create_ts = parse_fcc_timestamp(item.get("create_ts", ""))
                if create_ts and create_ts < cutoff:
                    continue

                file_manager_id = item.get("file_manager_id", "")
                folder_id = item.get("folder_id", "")
                if not file_manager_id:
                    continue

                fcc_filing_id = f"{entity_id}:{file_manager_id}"
                existing = await conn.fetchval("SELECT id FROM radar_items WHERE fcc_filing_id = $1", fcc_filing_id)
                if existing:
                    continue

                path_meta = parse_folder_path(item.get("file_folder_path", ""))
                advertiser_name = path_meta.get("advertiser_name") or item.get("file_name") or "Unknown"
                office_type = path_meta.get("office_type")
                spender_type = "Issue Org" if office_type == "Non-Candidate" else ("Campaign" if office_type in ("Federal", "State") else None)
                filing_url = f"https://publicfiles.fcc.gov/api/manager/download/{folder_id}/{file_manager_id}.pdf" if folder_id and file_manager_id else None

                batch_rows.append((
                    uuid.uuid4(), fcc_filing_id, call_sign, market,
                    advertiser_name, spender_type, None, None, None, filing_url,
                    "new", None, create_ts or now, now, now,
                ))
                station_filings += 1
                total_new += 1

                if len(batch_rows) >= 200:
                    await conn.executemany(
                        """INSERT INTO radar_items (id, fcc_filing_id, station_call_sign, market_name, spender_name,
                           spender_type, flight_start, flight_end, total_dollars, filing_url,
                           status, matched_buy_id, detected_at, created_at, updated_at)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
                           ON CONFLICT DO NOTHING""",
                        batch_rows,
                    )
                    logger.info(f"  Batch inserted {len(batch_rows)} items")
                    batch_rows = []

            if station_filings > 0:
                filled += 1
                total_found += station_filings
                logger.info(f"  ✅ {call_sign} ({market}): {station_filings} filings recovered")

            if (i + 1) % 50 == 0:
                logger.info(f"  Progress: {i+1}/{len(gaps)} checked, {filled} filled, {total_new} new filings")

            await asyncio.sleep(0.3)

    # Final batch
    if batch_rows:
        await conn.executemany(
            """INSERT INTO radar_items (id, fcc_filing_id, station_call_sign, market_name, spender_name,
               spender_type, flight_start, flight_end, total_dollars, filing_url,
               status, matched_buy_id, detected_at, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
               ON CONFLICT DO NOTHING""",
            batch_rows,
        )
        logger.info(f"  Batch inserted {len(batch_rows)} items")

    logger.info(f"\n{'='*60}")
    logger.info(f"BACKFILL COMPLETE")
    logger.info(f"{'='*60}")
    logger.info(f"Stations checked:  {len(gaps)}")
    logger.info(f"Stations filled:   {filled}")
    logger.info(f"New filings added: {total_new}")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
