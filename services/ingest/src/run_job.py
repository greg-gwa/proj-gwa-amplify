"""
Cloud Run Job entry point for CM ad scanning.

Run via:  python -m src.run_job
(Dockerfile CMD is overridden when the job is executed)

Required environment variables:
  SCAN_ID     — UUID that matches a row in cm_scans (created by the caller before launching the job)

Optional environment variables:
  MARKET_IDS  — JSON array of market UUID strings, e.g. '["uuid1","uuid2"]'
                If absent, all active monitors are scanned.
"""

import asyncio
import json
import logging
import os
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


async def main() -> None:
    scan_id = os.environ.get("SCAN_ID", "").strip()
    if not scan_id:
        logger.error("SCAN_ID environment variable is required")
        sys.exit(1)

    market_ids: list[str] | None = None
    raw = os.environ.get("MARKET_IDS", "").strip()
    if raw:
        try:
            market_ids = json.loads(raw)
            if not isinstance(market_ids, list):
                raise ValueError("MARKET_IDS must be a JSON array")
        except (json.JSONDecodeError, ValueError) as exc:
            logger.error("Invalid MARKET_IDS: %s", exc)
            sys.exit(1)

    logger.info("CM scan job starting — scan_id=%s markets=%s", scan_id, market_ids)

    # Import here so module-level asyncio.Semaphore objects in scan_cm are created
    # inside the running event loop (Python 3.12 requirement).
    from src.db import get_pool, close_pool  # noqa: E402
    from src.scan_cm import run_cm_scan  # noqa: E402

    try:
        await get_pool()
        await run_cm_scan(scan_id, market_ids=market_ids)
        logger.info("CM scan job completed — scan_id=%s", scan_id)
    finally:
        await close_pool()


if __name__ == "__main__":
    asyncio.run(main())
