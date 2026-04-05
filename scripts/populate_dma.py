#!/usr/bin/env python3
"""
Populate the `dma` column on the stations table by querying the FCC API
for each station's Nielsen DMA.

Usage:
    DATABASE_URL=postgres://... python scripts/populate_dma.py
"""

import asyncio
import logging
import os
import re
import time

import asyncpg
import httpx

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

FCC_BASE = "https://publicfiles.fcc.gov/api"
THROTTLE_SECONDS = 0.3


def strip_suffix(call_sign: str) -> str:
    """Strip -TV/-FM/-AM/-DT/-LP/-CA/-CD suffix for FCC search."""
    return re.sub(r"-(TV|FM|AM|DT|LP|CA|CD)$", "", call_sign.upper()).strip()


async def fetch_dma(client: httpx.AsyncClient, call_sign: str) -> str | None:
    """Query FCC facility search and return the nielsenDma field."""
    clean = strip_suffix(call_sign)
    try:
        resp = await client.get(f"{FCC_BASE}/service/tv/facility/search/{clean}")
        resp.raise_for_status()
        data = resp.json()

        facilities = []
        if isinstance(data, dict):
            search_results = data.get("results", {})
            if isinstance(search_results, dict):
                for entry in search_results.get("searchList", []):
                    facilities.extend(entry.get("facilityList", []))
            elif isinstance(search_results, list):
                facilities = search_results
        elif isinstance(data, list):
            facilities = data

        for item in facilities:
            dma = item.get("nielsenDma")
            if dma:
                return dma

        return None
    except Exception as e:
        logger.warning(f"FCC lookup failed for {call_sign}: {e}")
        return None


async def main():
    dsn = os.environ["DATABASE_URL"]
    pool = await asyncpg.create_pool(dsn=dsn, min_size=1, max_size=5)

    async with pool.acquire() as conn:
        stations = await conn.fetch("SELECT call_sign FROM stations ORDER BY call_sign")

    total = len(stations)
    logger.info(f"Found {total} stations to process")

    updated = 0
    skipped = 0
    errors = 0

    async with httpx.AsyncClient(timeout=30.0, headers={"Accept": "application/json"}) as client:
        for i, row in enumerate(stations):
            call_sign = row["call_sign"]

            dma = await fetch_dma(client, call_sign)

            if dma:
                async with pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE stations SET dma = $1 WHERE call_sign = $2",
                        dma, call_sign,
                    )
                updated += 1
            else:
                skipped += 1

            if (i + 1) % 50 == 0:
                logger.info(
                    f"Progress: {i + 1}/{total} — "
                    f"{updated} updated, {skipped} skipped, {errors} errors"
                )

            time.sleep(THROTTLE_SECONDS)

    logger.info(
        f"Done: {total} stations processed — "
        f"{updated} updated, {skipped} skipped, {errors} errors"
    )
    await pool.close()


if __name__ == "__main__":
    asyncio.run(main())
