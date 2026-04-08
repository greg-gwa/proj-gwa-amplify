"""
Match engine for FCC radar items — fuzzy matches against spenders and buys tables.

Uses rapidfuzz (Jaro-Winkler + token_set_ratio) for Python-side scoring,
with pg_trgm as a pre-filter to narrow candidates.
"""

import logging
import re
from datetime import date, timedelta
from typing import Optional

from rapidfuzz import fuzz
from rapidfuzz.distance import JaroWinkler

logger = logging.getLogger(__name__)

# Common suffixes to strip before comparison
_STRIP_SUFFIXES = [
    "FOR SENATE", "FOR CONGRESS", "FOR MARYLAND", "FOR GOVERNOR",
    "FOR HOUSE", "FOR PRESIDENT", "FOR AMERICA", "FOR VIRGINIA",
    "FOR OHIO", "FOR MICHIGAN", "FOR WISCONSIN", "FOR PENNSYLVANIA",
    "FOR ARIZONA", "FOR GEORGIA", "FOR NEVADA", "FOR TEXAS",
    "FOR NORTH CAROLINA", "FOR FLORIDA", "FOR IOWA", "FOR MINNESOTA",
    "COMMITTEE", "CMTE", "POLITICAL ACTION COMMITTEE",
    "PAC", "SUPER PAC", "INC", "LLC", "LLP", "CORP", "CORPORATION",
    "THE", "OF",
]

# Pre-compiled pattern for suffix stripping
_SUFFIX_PATTERN = re.compile(
    r'\b(?:' + '|'.join(re.escape(s) for s in _STRIP_SUFFIXES) + r')\b',
    re.IGNORECASE,
)


def _normalize(name: str) -> str:
    """Normalize a name for comparison."""
    return " ".join(name.strip().upper().split())


def _normalize_for_fuzzy(name: str) -> str:
    """Normalize a name for fuzzy comparison: strip common suffixes, punctuation."""
    n = name.strip().upper()
    # Remove common suffixes
    n = _SUFFIX_PATTERN.sub("", n)
    # Remove punctuation
    n = re.sub(r"[^\w\s]", "", n)
    # Collapse whitespace
    n = " ".join(n.split()).strip()
    return n


def _score_names(name_a: str, name_b: str) -> float:
    """Combined score: 0.6 * JaroWinkler + 0.4 * token_set_ratio."""
    norm_a = _normalize_for_fuzzy(name_a)
    norm_b = _normalize_for_fuzzy(name_b)
    if not norm_a or not norm_b:
        return 0.0
    jw = JaroWinkler.similarity(norm_a, norm_b)
    tsr = fuzz.token_set_ratio(norm_a, norm_b) / 100.0
    return 0.6 * jw + 0.4 * tsr


async def match_to_spender(conn, advertiser_name: str) -> Optional[dict]:
    """
    Fuzzy match an advertiser name against the spenders table.

    Strategy:
    1. Check spender_aliases for exact match
    2. Exact normalized name match
    3. pg_trgm pre-filter (wide net, similarity > 0.3) → rapidfuzz Python-side scoring
       Combined score (JaroWinkler + token_set_ratio) >= 0.75 required

    Returns dict with id, name, type, party, confidence or None.
    """
    if not advertiser_name:
        return None

    normalized = _normalize(advertiser_name)

    # 1. Check aliases table for exact match
    try:
        row = await conn.fetchrow(
            """SELECT sa.spender_id, s.name, s.type, s.party
               FROM spender_aliases sa
               JOIN spenders s ON s.id = sa.spender_id
               WHERE UPPER(TRIM(sa.alias)) = $1
               LIMIT 1""",
            normalized,
        )
        if row:
            logger.info(f"Spender alias match: '{advertiser_name}' → '{row['name']}'")
            return {
                "id": row["spender_id"],
                "name": row["name"],
                "type": row["type"],
                "party": row["party"],
                "confidence": 1.0,
            }
    except Exception as e:
        logger.debug(f"Alias table lookup failed (may not exist yet): {e}")

    # 2. Exact normalized match
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

    # 3. pg_trgm pre-filter (wide net) → Python-side rapidfuzz scoring
    try:
        candidates = await conn.fetch(
            """SELECT id, name, type, party
               FROM spenders
               WHERE similarity(UPPER(TRIM(name)), $1) > 0.3
               ORDER BY similarity(UPPER(TRIM(name)), $1) DESC
               LIMIT 20""",
            normalized,
        )
    except Exception:
        # pg_trgm not available — fall back to LIKE
        candidates = await conn.fetch(
            """SELECT id, name, type, party FROM spenders
               WHERE UPPER(TRIM(name)) LIKE '%' || $1 || '%'
                  OR $1 LIKE '%' || UPPER(TRIM(name)) || '%'
               ORDER BY LENGTH(name) ASC
               LIMIT 20""",
            normalized,
        )

    if candidates:
        best_row = None
        best_score = 0.0
        for cand in candidates:
            score = _score_names(advertiser_name, cand["name"])
            if score > best_score:
                best_score = score
                best_row = cand

        if best_row and best_score >= 0.75:
            logger.info(
                f"Spender fuzzy match: '{advertiser_name}' → '{best_row['name']}' "
                f"(score={best_score:.3f})"
            )
            return {
                "id": best_row["id"],
                "name": best_row["name"],
                "type": best_row["type"],
                "party": best_row["party"],
                "confidence": best_score,
            }

    logger.info(f"No spender match for: '{advertiser_name}'")
    return None


async def match_to_buy(
    conn,
    spender_name: str,
    station: str,
    flight_start: Optional[date],
    flight_end: Optional[date],
    dollars: Optional[float],
    spender_confidence: float = 0.0,
) -> Optional[dict]:
    """
    Match against buys table using 4-point criteria:
      1. Same spender (by normalized name)
      2. Same station (via buy_lines)
      3. Date overlap (±3 days)
      4. Dollars within 10%

    Threshold: 3 points normally, or 2 points when spender_confidence >= 0.85
    AND station matches (spender + station alone is highly indicative).

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
        has_station_match = False
        if station:
            points += 1
            has_station_match = True

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

    # Lower threshold: 2 points when high-confidence spender + station match
    threshold = 3
    if spender_confidence >= 0.85 and station:
        threshold = 2

    if best_match and best_points >= threshold:
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
