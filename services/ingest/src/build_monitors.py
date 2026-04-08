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
    """Parse time strings like '7a-730a', '10p-1030p', '8-830pm' into (HH:MM, HH:MM).
    
    If only the end time has an AM/PM suffix, the start time inherits it.
    e.g., '8-830pm' → 20:00-20:30 (not 08:00-20:30)
    """
    if not time_str:
        return None
    t = time_str.strip().upper().replace(" ", "")
    parts = t.split("-")
    if len(parts) != 2:
        return None

    start_raw, end_raw = parts[0].strip(), parts[1].strip()

    start_has_pm = "P" in start_raw
    start_has_am = "A" in start_raw
    end_has_pm = "P" in end_raw
    end_has_am = "A" in end_raw

    # If start has no AM/PM suffix, inherit from end
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
            h, m = int(h), int(m)
        except ValueError:
            return None
        if is_pm and h < 12:
            h += 12
        if is_am and h == 12:
            h = 0
        return f"{h:02d}:{m:02d}"

    start = convert(start_raw, forced_pm=start_has_pm and "P" not in start_raw, forced_am=start_has_am and "A" not in start_raw)
    end = convert(end_raw)

    if start and end:
        # Sanity: if end < start and start wasn't explicitly AM, start is probably PM too
        if end < start and not (start_has_am or "A" in start_raw):
            sh = int(start[:2])
            if sh < 12:
                start = f"{sh + 12:02d}:{start[3:]}"
        return (start, end)
    return None


def parse_days(days_str: str) -> str:
    """Normalize day strings. Handles WideOrbit 7-slot positional format.
    
    WideOrbit uses 7 positional slots: M T W T F S S
    where '-' means that day is excluded.
    e.g., 'M-WTF--' = Mon, skip Tue, Wed, Thu, Fri, skip Sat, skip Sun
         'MTWTF--' = all weekdays
         '-----S-' = Sat only
         '------S' = Sun only
    """
    if not days_str:
        return "MTWTF"
    d = days_str.strip().upper()
    if d in ("M-F", "MON-FRI", "WEEKDAYS"):
        return "MTWTF"
    if d in ("SA", "SAT", "SATURDAY"):
        return "S"
    if d in ("SU", "SUN", "SUNDAY"):
        return "Su"
    if d in ("M-SU", "MON-SUN", "DAILY"):
        return "MTWTFSSu"

    # WideOrbit 7-slot positional format
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
