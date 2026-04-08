#!/usr/bin/env python3
"""
Build monitoring windows from parsed FCC contracts.

Reads radar_items where document_type = 'CONTRACT' and parsed_data has line_items,
creates monitor rows for each daypart/window within the flight dates.

Run periodically or after batch parse completes.
"""

import asyncio
import json
import logging
import os
import re
import sys
import uuid
from datetime import datetime, timezone, date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import asyncpg

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s: %(message)s")
log = logging.getLogger("build_monitors")


def parse_time(time_str: str) -> tuple[str, str] | None:
    """Parse time strings like '7a-730a', '10p-1030p', '5P-530P' into HH:MM format."""
    if not time_str:
        return None

    # Normalize
    t = time_str.strip().upper().replace(" ", "")

    # Try to split on dash
    parts = t.split("-")
    if len(parts) != 2:
        return None

    # Determine AM/PM context: if only one part has a suffix, it applies to both.
    # e.g., "8-830pm" means 8pm-8:30pm, "11a-12p" means 11am-12pm
    start_raw, end_raw = parts[0].strip(), parts[1].strip()

    start_has_pm = "P" in start_raw
    start_has_am = "A" in start_raw
    end_has_pm = "P" in end_raw
    end_has_am = "A" in end_raw

    # If start has no AM/PM suffix, inherit from end
    # (e.g., "8-830pm" → start is also PM; "11-12p" → start is also PM unless explicitly AM)
    if not start_has_pm and not start_has_am:
        if end_has_pm:
            start_has_pm = True
        elif end_has_am:
            start_has_am = True

    def convert(p, forced_pm=False, forced_am=False):
        p = p.strip()
        is_pm = "P" in p or forced_pm
        is_am = "A" in p or forced_am
        p = p.replace("A", "").replace("P", "").replace("M", "")

        if not p:
            return None

        if ":" in p:
            h, m = p.split(":")
        elif len(p) <= 2:
            h, m = p, "00"
        elif len(p) == 3:
            h, m = p[0], p[1:]
        elif len(p) == 4:
            h, m = p[:2], p[2:]
        else:
            return None

        try:
            h = int(h)
            m = int(m)
        except ValueError:
            return None

        if is_pm and h < 12:
            h += 12
        if is_am and h == 12:
            h = 0

        return f"{h:02d}:{m:02d}"

    start = convert(start_raw, forced_pm=start_has_pm and not ("P" in start_raw), forced_am=start_has_am and not ("A" in start_raw))
    end = convert(end_raw)

    if start and end:
        # Sanity check: if end < start, we probably mis-parsed AM/PM
        # e.g., "11a-12p" → 11:00, 12:00 is fine
        # "8-830pm" → should be 20:00-20:30, not 08:00-20:30
        if end < start and not (start_has_am or "A" in start_raw):
            # Start was probably PM too
            sh = int(start[:2])
            if sh < 12:
                start = f"{sh + 12:02d}:{start[3:]}"
        return (start, end)
    return None


def parse_days(days_str: str) -> str:
    """Normalize day strings like 'M-F', 'M-WTF--', 'MTWTF--', 'Sa', 'Su' etc.
    
    WideOrbit format uses 7 positional slots: M T W T F S S
    where '-' means that day is excluded.
    e.g., 'M-WTF--' = Mon, -, Wed, Thu, Fri, -, - = Mon/Wed/Thu/Fri (no Tuesday)
         'MTWTF--' = Mon, Tue, Wed, Thu, Fri, -, - = all weekdays
         '-----S-' = Sat only
         '------S' = Sun only
    """
    if not days_str:
        return "MTWTF"  # default to weekdays

    d = days_str.strip().upper()

    # Common shorthand
    if d in ("M-F", "MON-FRI", "WEEKDAYS"):
        return "MTWTF"
    if d in ("SA", "SAT", "SATURDAY"):
        return "S"
    if d in ("SU", "SUN", "SUNDAY"):
        return "Su"
    if d in ("M-SU", "MON-SUN", "DAILY"):
        return "MTWTFSSu"

    # WideOrbit 7-slot positional format (e.g., "M-WTF--", "MTWTFSS", "-----S-")
    slot_labels = ["M", "T", "W", "T", "F", "S", "Su"]
    if len(d) == 7:
        result = ""
        for i, c in enumerate(d):
            if c != "-":
                result += slot_labels[i]
        return result or "MTWTF"

    # Fallback: extract known day letters
    result = ""
    for c in d:
        if c in "MTWFS" and c != "-":
            result += c
    return result or "MTWTF"


async def main():
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: Set DATABASE_URL")
        sys.exit(1)

    conn = await asyncpg.connect(dsn=dsn)

    # Get all parsed contracts with line items that don't already have monitors
    contracts = await conn.fetch('''
        SELECT r.id, r.station_call_sign, r.spender_name, r.flight_start, r.flight_end,
               r.station_id, r.market_id, r.parsed_data
        FROM radar_items r
        WHERE r.document_type IN ('CONTRACT', 'ORDER')
          AND r.parsed_data IS NOT NULL
          AND r.flight_start IS NOT NULL
          AND r.flight_end IS NOT NULL
          AND r.flight_end >= CURRENT_DATE  -- only active/future flights
          AND r.id NOT IN (SELECT DISTINCT radar_item_id FROM monitors)
    ''')

    log.info(f"Found {len(contracts)} contracts to build monitors from")

    total_monitors = 0
    total_contracts = 0

    for contract in contracts:
        rid = contract['id']
        station = contract['station_call_sign']
        spender = contract['spender_name']
        flight_start = contract['flight_start']
        flight_end = contract['flight_end']
        station_id = contract['station_id']
        market_id = contract['market_id']

        parsed = contract['parsed_data']
        if isinstance(parsed, str):
            parsed = json.loads(parsed)

        line_items = parsed.get('line_items', [])
        if not line_items:
            continue

        spot_length = parsed.get('spot_length', 30)
        monitors_created = 0

        for item in line_items:
            daypart = item.get('daypart', '')
            time_str = item.get('time', '')
            days_str = item.get('days', '')
            item_length = item.get('length', spot_length)

            # Parse time window
            times = parse_time(time_str)
            if not times and daypart:
                # Try parsing from daypart description
                # e.g., "Morning News 7a-730a" → extract "7a-730a"
                time_match = re.search(r'(\d+[ap]?\s*-\s*\d+[ap]?)', daypart, re.IGNORECASE)
                if time_match:
                    times = parse_time(time_match.group(1))

            if not times:
                continue

            time_start, time_end = times
            days = parse_days(days_str)

            await conn.execute('''
                INSERT INTO monitors
                    (id, radar_item_id, station_call_sign, station_id, market_id,
                     spender_name, daypart, time_start, time_end, days,
                     flight_start, flight_end, spot_length, status)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
                ON CONFLICT (radar_item_id, station_call_sign, daypart, time_start, time_end, flight_start, flight_end)
                DO NOTHING
            ''',
                uuid.uuid4(), rid, station, station_id, market_id,
                spender, daypart, time_start, time_end, days,
                flight_start, flight_end, item_length, 'active'
            )
            monitors_created += 1

        if monitors_created > 0:
            total_contracts += 1
            total_monitors += monitors_created
            log.info(f"  {spender} @ {station}: {monitors_created} windows ({flight_start}→{flight_end})")

    # Expire monitors whose flight has ended
    expired = await conn.fetchval('''
        UPDATE monitors SET status = 'expired', updated_at = NOW()
        WHERE status = 'active' AND flight_end < CURRENT_DATE
        RETURNING count(*)
    ''')

    log.info(f"\n{'='*60}")
    log.info(f"MONITORS BUILT")
    log.info(f"{'='*60}")
    log.info(f"Contracts processed: {total_contracts}")
    log.info(f"Monitor windows created: {total_monitors}")
    log.info(f"Monitors expired: {expired or 0}")

    # Show what's active right now
    active = await conn.fetch('''
        SELECT station_call_sign, spender_name, daypart, time_start, time_end,
               days, flight_start, flight_end, spot_length
        FROM monitors
        WHERE status = 'active'
          AND flight_start <= CURRENT_DATE
          AND flight_end >= CURRENT_DATE
        ORDER BY station_call_sign, time_start
        LIMIT 30
    ''')

    if active:
        log.info(f"\nACTIVE MONITORING WINDOWS ({len(active)} shown):")
        for m in active:
            log.info(
                f"  {m['station_call_sign']} | {m['time_start']}-{m['time_end']} {m['days']} | "
                f"{m['spender_name']} | :{m['spot_length']}s | {m['flight_start']}→{m['flight_end']}"
            )

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
