#!/usr/bin/env python3
"""
National FCC Scan — K stations (western US) + 2-year lookback.
"""

import asyncio
import json
import logging
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone, date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "ingest"))

import asyncpg
import httpx

from src.fcc_client import parse_folder_path, parse_fcc_timestamp

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("national_scan_k")

FCC_BASE = "https://publicfiles.fcc.gov/api"
LOOKBACK_DAYS = 730  # 2 years


async def get_k_stations(client: httpx.AsyncClient) -> list[dict]:
    """Pull K-prefix TV stations from FCC."""
    all_stations = []
    seen_ids = set()

    try:
        resp = await client.get(
            f"{FCC_BASE}/service/tv/facility/search/K",
            timeout=120.0,
        )
        if resp.status_code == 200:
            data = resp.json()
            results = data.get("results", {})
            for entry in results.get("searchList", []):
                for fac in entry.get("facilityList", []):
                    fac_id = str(fac.get("id", ""))
                    if fac_id and fac_id not in seen_ids:
                        seen_ids.add(fac_id)
                        all_stations.append({
                            "entity_id": fac_id,
                            "call_sign": fac.get("callSign", ""),
                            "network": fac.get("networkAfil", ""),
                            "dma": fac.get("nielsenDma", ""),
                            "city": fac.get("communityCity", ""),
                            "state": fac.get("communityState", ""),
                            "service": fac.get("service", ""),
                            "status": fac.get("status", ""),
                        })
            logger.info(f"K stations: {len(all_stations)} total")
        else:
            logger.error(f"K prefix: HTTP {resp.status_code}")
    except Exception as e:
        logger.error(f"K prefix error: {e}")

    active = [s for s in all_stations if s.get("status") == "LICENSED"]
    logger.info(f"K stations active/licensed: {len(active)}")
    return active


async def get_filings_for_station(client, entity_id, call_sign, cutoff):
    try:
        resp = await client.get(
            f"{FCC_BASE}/manager/search/key/Political File.json",
            params={"entityId": entity_id, "limit": 500},
            timeout=120.0,
        )
        if resp.status_code != 200:
            return []
        data = resp.json()
        files = []
        if isinstance(data, dict):
            sr = data.get("searchResult", {})
            if isinstance(sr, dict):
                files = sr.get("files", [])

        filings = []
        for item in files:
            create_ts = parse_fcc_timestamp(item.get("create_ts", ""))
            if create_ts and create_ts < cutoff:
                continue
            file_folder_path = item.get("file_folder_path", "")
            path_meta = parse_folder_path(file_folder_path)
            filings.append({
                "file_id": item.get("file_id"),
                "file_manager_id": item.get("file_manager_id"),
                "folder_id": item.get("folder_id"),
                "file_name": item.get("file_name", ""),
                "file_folder_path": file_folder_path,
                "create_ts": item.get("create_ts"),
                "entity_id": entity_id,
                "call_sign": call_sign,
                **path_meta,
            })
        return filings
    except Exception as e:
        logger.error(f"Filings error for {call_sign} ({entity_id}): {e}")
        return []


async def _batch_insert(conn, rows):
    await conn.executemany(
        """INSERT INTO radar_items
           (id, fcc_filing_id, station_call_sign, market_name, spender_name,
            spender_type, flight_start, flight_end, total_dollars, filing_url,
            status, matched_buy_id, detected_at, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
           ON CONFLICT DO NOTHING""",
        rows,
    )
    logger.info(f"  Batch inserted {len(rows)} radar items")


async def main():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: Set DATABASE_URL")
        sys.exit(1)

    conn = await asyncpg.connect(dsn=dsn)
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=LOOKBACK_DAYS)
    scan_id = uuid.uuid4()

    await conn.execute("INSERT INTO radar_scans (id, started_at) VALUES ($1, $2)", scan_id, now)

    logger.info(f"=== National FCC Scan — K Stations ===")
    logger.info(f"Lookback: {LOOKBACK_DAYS} days (since {cutoff.date()})")

    async with httpx.AsyncClient(headers={"Accept": "application/json"}, follow_redirects=True) as client:
        stations = await get_k_stations(client)
        logger.info(f"Found {len(stations)} active K stations")

        # Store stations
        for s in stations:
            try:
                await conn.execute(
                    """INSERT INTO stations (id, call_sign, network, market_name, owner, media_type, created_at)
                       VALUES ($1, $2, $3, $4, $5, 'TV', $6) ON CONFLICT DO NOTHING""",
                    uuid.uuid4(), s["call_sign"], s["network"],
                    f"{s['city']}, {s['state']}" if s.get("city") else s.get("dma"),
                    None, now,
                )
            except Exception:
                pass

        total_filings = 0
        total_new = 0
        stations_scanned = 0
        stations_with_filings = 0
        errors = 0
        batch_rows = []

        for i, station in enumerate(stations):
            try:
                filings = await get_filings_for_station(client, station["entity_id"], station["call_sign"], cutoff)
                stations_scanned += 1
                if filings:
                    stations_with_filings += 1

                for filing in filings:
                    total_filings += 1
                    file_manager_id = filing.get("file_manager_id", "")
                    folder_id = filing.get("folder_id", "")
                    if not file_manager_id:
                        continue

                    fcc_filing_id = f"{station['entity_id']}:{file_manager_id}"
                    existing = await conn.fetchval("SELECT id FROM radar_items WHERE fcc_filing_id = $1", fcc_filing_id)
                    if existing:
                        continue

                    advertiser_name = filing.get("advertiser_name") or filing.get("file_name") or "Unknown"
                    office_type = filing.get("office_type")
                    spender_type = None
                    if office_type == "Non-Candidate":
                        spender_type = "Issue Org"
                    elif office_type in ("Federal", "State"):
                        spender_type = "Campaign"

                    filing_url = f"https://publicfiles.fcc.gov/api/manager/download/{folder_id}/{file_manager_id}.pdf" if folder_id and file_manager_id else None
                    market_name = f"{station['city']}, {station['state']}" if station.get("city") else station.get("dma")
                    create_ts = parse_fcc_timestamp(filing.get("create_ts", ""))

                    batch_rows.append((
                        uuid.uuid4(), fcc_filing_id, station["call_sign"], market_name,
                        advertiser_name, spender_type, None, None, None, filing_url,
                        "new", None, create_ts or now, now, now,
                    ))
                    total_new += 1

                    if len(batch_rows) >= 200:
                        await _batch_insert(conn, batch_rows)
                        batch_rows = []

                if (i + 1) % 50 == 0:
                    logger.info(f"Progress: {i+1}/{len(stations)} stations | {total_filings} filings | {total_new} new | {stations_with_filings} with political files")

                await asyncio.sleep(0.3)
            except Exception as e:
                errors += 1
                logger.error(f"Error scanning {station['call_sign']}: {e}")

        if batch_rows:
            await _batch_insert(conn, batch_rows)

    await conn.execute(
        """UPDATE radar_scans SET completed_at=$2, stations_scanned=$3, filings_found=$4,
           new_items=$5, matched_items=0, errors=$6 WHERE id=$1""",
        scan_id, datetime.now(timezone.utc), stations_scanned, total_filings, total_new, errors,
    )

    logger.info(f"\n{'='*60}")
    logger.info(f"K STATIONS SCAN COMPLETE")
    logger.info(f"{'='*60}")
    logger.info(f"Stations scanned:      {stations_scanned}")
    logger.info(f"Stations with filings: {stations_with_filings}")
    logger.info(f"Total filings:         {total_filings}")
    logger.info(f"New items indexed:     {total_new}")
    logger.info(f"Errors:                {errors}")

    top = await conn.fetch(
        """SELECT spender_name, COUNT(*) as cnt, COUNT(DISTINCT station_call_sign) as stn
           FROM radar_items GROUP BY spender_name ORDER BY cnt DESC LIMIT 20"""
    )
    logger.info(f"\nTOP 20 SPENDERS (national):")
    for row in top:
        logger.info(f"  {row['cnt']:5d} filings | {row['stn']:3d} stations | {row['spender_name']}")

    await conn.close()
    logger.info("Done.")


if __name__ == "__main__":
    asyncio.run(main())
