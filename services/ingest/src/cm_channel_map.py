"""
Station ↔ CM channel mapping.

On first scan, fetches all CM channels and matches them to stations.call_sign.
Results are persisted to stations.cm_channel_id so the lookup is cached.
"""

import logging
from typing import Optional

from src.cm_client import CMClient

logger = logging.getLogger(__name__)


async def build_channel_map(pool, cm: CMClient) -> dict[str, int]:
    """
    Fetch all CM channels, match against stations table, persist matches.
    Returns {call_sign: cm_channel_id} for all matched stations.
    """
    async with pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT DISTINCT call_sign FROM stations WHERE call_sign IS NOT NULL ORDER BY call_sign"
        )

    if not rows:
        return {}

    call_signs = [r["call_sign"] for r in rows]

    # Fetch all CM channels in one request (already charged to budget)
    channels = await cm.get_channels()

    # Build normalized lookup: UPPER(callSign) → channel_id
    cm_lookup: dict[str, int] = {}
    for ch in channels:
        raw_name = (
            ch.get("callSign")
            or ch.get("call_sign")
            or ch.get("name")
            or ""
        )
        cid = ch.get("id")
        if raw_name and cid:
            cm_lookup[raw_name.upper()] = int(cid)

    result: dict[str, int] = {}
    updates: list[tuple[int, str]] = []

    for cs in call_signs:
        upper = cs.upper()
        cid = cm_lookup.get(upper)

        if not cid:
            # Try stripping common suffixes: -HD, -DT, HD, DT
            for suffix in ("-HD", "-DT", "-TV", "-FM", "-AM", " HD", " DT"):
                stripped = upper.removesuffix(suffix)
                if stripped != upper:
                    cid = cm_lookup.get(stripped)
                    if cid:
                        break

        if cid:
            result[cs] = cid
            updates.append((cid, cs))

    # Persist mappings to DB
    if updates:
        async with pool.acquire() as conn:
            await conn.executemany(
                "UPDATE stations SET cm_channel_id = $1 WHERE call_sign = $2",
                updates,
            )

    logger.info(f"CM channel map built: {len(result)}/{len(call_signs)} stations matched")
    return result


async def get_channel_id(pool, call_sign: str) -> Optional[int]:
    """Return the cached CM channel ID for a station, or None."""
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "SELECT cm_channel_id FROM stations WHERE call_sign = $1",
            call_sign,
        )
    return row["cm_channel_id"] if row else None
