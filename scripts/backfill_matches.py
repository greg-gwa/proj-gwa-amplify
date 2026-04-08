#!/usr/bin/env python3
"""
Backfill matches — re-runs improved matching against all unmatched radar_items.

Uses the rapidfuzz-based match_to_spender + match_to_buy from match_radar.py
to find matches that the old pg_trgm-only approach missed.
"""

import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "ingest"))

import asyncpg

from src.match_radar import match_to_spender, match_to_buy

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("backfill_matches")


async def main():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: Set DATABASE_URL")
        sys.exit(1)

    conn = await asyncpg.connect(dsn=dsn)

    # Find all unmatched radar items
    items = await conn.fetch("""
        SELECT id, spender_name, station_call_sign, flight_start, flight_end, total_dollars
        FROM radar_items
        WHERE status = 'new'
          AND spender_name IS NOT NULL
          AND spender_name != ''
        ORDER BY detected_at DESC
    """)

    logger.info(f"Found {len(items)} unmatched radar items to re-process")

    stats = {
        "total": len(items),
        "matched_to_buy": 0,
        "likely_match": 0,
        "spender_matched": 0,
        "still_unmatched": 0,
        "errors": 0,
    }

    for i, item in enumerate(items):
        try:
            spender_match = await match_to_spender(conn, item["spender_name"])

            if not spender_match:
                stats["still_unmatched"] += 1
                continue

            stats["spender_matched"] += 1

            buy_match = await match_to_buy(
                conn,
                spender_name=spender_match["name"],
                station=item["station_call_sign"] or "",
                flight_start=item["flight_start"],
                flight_end=item["flight_end"],
                dollars=float(item["total_dollars"]) if item["total_dollars"] else None,
                spender_confidence=spender_match["confidence"],
            )

            if buy_match and buy_match["match_points"] >= 3:
                await conn.execute(
                    """UPDATE radar_items
                       SET status = 'matched_to_buy', matched_buy_id = $1, updated_at = NOW()
                       WHERE id = $2""",
                    buy_match["buy_id"],
                    item["id"],
                )
                stats["matched_to_buy"] += 1
            elif buy_match and buy_match["match_points"] >= 2:
                await conn.execute(
                    """UPDATE radar_items
                       SET status = 'likely_match', matched_buy_id = $1, updated_at = NOW()
                       WHERE id = $2""",
                    buy_match["buy_id"],
                    item["id"],
                )
                stats["likely_match"] += 1
            else:
                stats["still_unmatched"] += 1

        except Exception as e:
            logger.error(f"Error processing radar item {item['id']}: {e}")
            stats["errors"] += 1

        if (i + 1) % 100 == 0:
            logger.info(
                f"Progress: {i+1}/{stats['total']} — "
                f"matched_to_buy={stats['matched_to_buy']}, "
                f"likely={stats['likely_match']}, "
                f"unmatched={stats['still_unmatched']}"
            )

    await conn.close()

    logger.info(f"\n{'='*60}")
    logger.info("BACKFILL MATCHES COMPLETE")
    logger.info(f"{'='*60}")
    logger.info(f"Total radar items:   {stats['total']}")
    logger.info(f"Spender matched:     {stats['spender_matched']}")
    logger.info(f"→ matched_to_buy:    {stats['matched_to_buy']}")
    logger.info(f"→ likely_match:      {stats['likely_match']}")
    logger.info(f"Still unmatched:     {stats['still_unmatched']}")
    logger.info(f"Errors:              {stats['errors']}")


if __name__ == "__main__":
    asyncio.run(main())
