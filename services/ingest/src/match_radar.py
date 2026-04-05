"""
Match engine for FCC radar items — fuzzy matches against spenders and buys tables.
"""

import logging
from datetime import date, timedelta
from typing import Optional

logger = logging.getLogger(__name__)


def _normalize(name: str) -> str:
    """Normalize a name for comparison."""
    return " ".join(name.strip().upper().split())


async def match_to_spender(conn, advertiser_name: str) -> Optional[dict]:
    """
    Fuzzy match an advertiser name against the spenders table.
    Uses PostgreSQL similarity() for fuzzy matching (requires pg_trgm extension),
    falls back to exact normalized match.

    Returns dict with id, name, type, party, confidence or None.
    """
    if not advertiser_name:
        return None

    normalized = _normalize(advertiser_name)

    # First try exact normalized match
    row = await conn.fetchrow(
        "SELECT id, name, type, party FROM spenders WHERE UPPER(TRIM(name)) = $1 LIMIT 1",
        normalized,
    )
    if row:
        logger.info(f"Spender exact match: '{advertiser_name}' → '{row['name']}'")
        return {
            "id": row["id"],
            "name": row["name"],
            "type": row["type"],
            "party": row["party"],
            "confidence": 1.0,
        }

    # Try LIKE-based partial match (common variations: with/without "Inc", "LLC", "PAC")
    # Match if the DB name contains the search term or vice versa
    row = await conn.fetchrow(
        """SELECT id, name, type, party FROM spenders
           WHERE UPPER(TRIM(name)) LIKE '%' || $1 || '%'
              OR $1 LIKE '%' || UPPER(TRIM(name)) || '%'
           ORDER BY LENGTH(name) ASC
           LIMIT 1""",
        normalized,
    )
    if row:
        logger.info(f"Spender partial match: '{advertiser_name}' → '{row['name']}'")
        return {
            "id": row["id"],
            "name": row["name"],
            "type": row["type"],
            "party": row["party"],
            "confidence": 0.8,
        }

    # Try pg_trgm similarity if available
    try:
        row = await conn.fetchrow(
            """SELECT id, name, type, party,
                      similarity(UPPER(TRIM(name)), $1) AS sim
               FROM spenders
               WHERE similarity(UPPER(TRIM(name)), $1) > 0.4
               ORDER BY sim DESC
               LIMIT 1""",
            normalized,
        )
        if row:
            sim = float(row["sim"])
            logger.info(f"Spender fuzzy match: '{advertiser_name}' → '{row['name']}' (sim={sim:.2f})")
            return {
                "id": row["id"],
                "name": row["name"],
                "type": row["type"],
                "party": row["party"],
                "confidence": sim,
            }
    except Exception as e:
        # pg_trgm extension may not be available
        logger.debug(f"Trigram similarity not available: {e}")

    logger.info(f"No spender match for: '{advertiser_name}'")
    return None


async def match_to_buy(
    conn,
    spender_name: str,
    station: str,
    flight_start: Optional[date],
    flight_end: Optional[date],
    dollars: Optional[float],
) -> Optional[dict]:
    """
    Match against buys table using 4-point criteria:
      1. Same spender (by normalized name)
      2. Same station (via buy_lines)
      3. Date overlap (±3 days)
      4. Dollars within 10%

    Returns dict with buy_id, match_points, confidence, or None.
    """
    if not spender_name:
        return None

    normalized_spender = _normalize(spender_name)

    # Build the query: join buys → buy_lines, match spender + station
    conditions = ["UPPER(TRIM(b.spender_name)) = $1"]
    params: list = [normalized_spender]
    idx = 2

    if station:
        # Normalize station call sign (strip -TV, -FM suffixes for matching)
        clean_station = station.replace("-TV", "").replace("-FM", "").strip().upper()
        conditions.append(
            f"(UPPER(REPLACE(bl.station_call_sign, '-', '')) = ${idx} "
            f"OR UPPER(bl.station_call_sign) = ${idx + 1})"
        )
        params.extend([clean_station, station.strip().upper()])
        idx += 2

    where = " AND ".join(conditions)

    rows = await conn.fetch(
        f"""SELECT b.id AS buy_id, b.spender_name, b.flight_start, b.flight_end,
                   b.total_dollars, bl.station_call_sign, bl.total_dollars AS line_dollars
            FROM buys b
            JOIN buy_lines bl ON bl.buy_id = b.id
            WHERE {where}
            ORDER BY b.created_at DESC
            LIMIT 20""",
        *params,
    )

    if not rows:
        return None

    best_match = None
    best_points = 0

    for row in rows:
        points = 1  # Already matched spender

        # Station match (already filtered in query)
        if station:
            points += 1

        # Date overlap check (±3 days)
        if flight_start and row["flight_start"]:
            buy_start = row["flight_start"]
            buy_end = row["flight_end"] or buy_start
            filing_start = flight_start
            filing_end = flight_end or filing_start

            # Expand ranges by 3 days for tolerance
            if (filing_start - timedelta(days=3)) <= buy_end and \
               (filing_end + timedelta(days=3)) >= buy_start:
                points += 1

        # Dollar match (within 10%)
        if dollars and dollars > 0:
            buy_dollars = float(row["total_dollars"] or 0)
            line_dollars = float(row["line_dollars"] or 0)
            compare_dollars = line_dollars if station else buy_dollars
            if compare_dollars > 0:
                ratio = min(dollars, compare_dollars) / max(dollars, compare_dollars)
                if ratio >= 0.9:
                    points += 1

        if points > best_points:
            best_points = points
            best_match = row

    if best_match and best_points >= 2:
        confidence = best_points / 4.0
        logger.info(
            f"Buy match: '{spender_name}' @ {station} → buy {best_match['buy_id']} "
            f"({best_points}/4 points, confidence={confidence:.2f})"
        )
        return {
            "buy_id": best_match["buy_id"],
            "match_points": best_points,
            "confidence": confidence,
            "spender_name": best_match["spender_name"],
            "station": best_match["station_call_sign"],
        }

    return None
