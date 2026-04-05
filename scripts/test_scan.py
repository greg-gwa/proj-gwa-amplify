#!/usr/bin/env python3
"""
Test script for FCC Radar Scanner.

Connects to the database, runs a scan against WJLA-TV only, and prints results.

Usage:
  DATABASE_URL=postgres://... python scripts/test_scan.py
"""

import asyncio
import json
import logging
import os
import sys

# Add the ingest service to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "ingest"))

import asyncpg
from src.scan_radar import scan

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("test_scan")


async def main():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: Set DATABASE_URL environment variable")
        sys.exit(1)

    print(f"Connecting to database...")
    conn = await asyncpg.connect(dsn=dsn)

    try:
        print("Running FCC radar scan for WJLA-TV...")
        result = await scan(conn, stations=["WJLA-TV"], lookback_hours=48)

        print("\n=== Scan Results ===")
        print(json.dumps(result, indent=2, default=str))

        # Show recent radar items
        rows = await conn.fetch(
            """SELECT spender_name, station_call_sign, status, total_dollars,
                      flight_start, flight_end, filing_url, created_at
               FROM radar_items
               ORDER BY created_at DESC
               LIMIT 10"""
        )

        print(f"\n=== Recent Radar Items ({len(rows)}) ===")
        for row in rows:
            dollars = f"${float(row['total_dollars']):,.2f}" if row["total_dollars"] else "N/A"
            flight = ""
            if row["flight_start"]:
                flight = f" | {row['flight_start']} → {row['flight_end'] or '?'}"
            print(
                f"  [{row['status']:>15}] {row['spender_name'] or 'Unknown':40s} "
                f"@ {row['station_call_sign']:8s} {dollars}{flight}"
            )
    finally:
        await conn.close()

    print("\nDone.")


if __name__ == "__main__":
    asyncio.run(main())
