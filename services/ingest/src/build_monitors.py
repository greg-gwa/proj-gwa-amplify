"""
Build monitoring windows from a parsed FCC contract.
Called inline from the scout and batch parser.
"""

import logging
import re
import uuid
from datetime import date

logger = logging.getLogger(__name__)


def parse_time(time_str: str):
    """Parse time strings like '7a-730a', '10p-1030p' into (HH:MM, HH:MM)."""
    if not time_str:
        return None
    t = time_str.strip().upper().replace(" ", "")
    parts = t.split("-")
    if len(parts) != 2:
        return None

    def convert(p):
        p = p.strip()
        is_pm = "P" in p
        is_am = "A" in p
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
            h, m = int(h), int(m)
        except ValueError:
            return None
        if is_pm and h < 12:
            h += 12
        if is_am and h == 12:
            h = 0
        return f"{h:02d}:{m:02d}"

    start = convert(parts[0])
    end = convert(parts[1])
    return (start, end) if start and end else None


def parse_days(days_str: str) -> str:
    if not days_str:
        return "MTWTF"
    d = days_str.strip().upper()
    if d in ("M-F", "MON-FRI", "WEEKDAYS"):
        return "MTWTF"
    if d in ("SA", "SAT", "SATURDAY"):
        return "S"
    if d in ("SU", "SUN", "SUNDAY"):
        return "U"
    result = ""
    for c in d:
        if c in "MTWTFSU" and c != "-":
            result += c
    return result or "MTWTF"


async def create_monitors_for_contract(conn, radar_item_id, station_call_sign, spender_name,
                                        station_id, market_id, flight_start, flight_end, parsed_data):
    """Create monitor windows from a parsed contract's line items."""
    if not parsed_data or not flight_start or not flight_end:
        return 0

    if isinstance(parsed_data, str):
        import json
        parsed_data = json.loads(parsed_data)

    line_items = parsed_data.get("line_items", [])
    if not line_items:
        return 0

    # Check if monitors already exist
    existing = await conn.fetchval(
        "SELECT COUNT(*) FROM monitors WHERE radar_item_id = $1", radar_item_id
    )
    if existing > 0:
        return 0

    spot_length = parsed_data.get("spot_length", 30)
    created = 0

    for item in line_items:
        daypart = item.get("daypart", "")
        time_str = item.get("time", "")
        days_str = item.get("days", "")
        item_length = item.get("length", spot_length)

        times = parse_time(time_str)
        if not times and daypart:
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
        ''',
            uuid.uuid4(), radar_item_id, station_call_sign, station_id, market_id,
            spender_name, daypart, time_start, time_end, days,
            flight_start, flight_end, item_length, 'active'
        )
        created += 1

    if created > 0:
        logger.info(f"Created {created} monitors: {spender_name} @ {station_call_sign} ({flight_start}→{flight_end})")

    return created
