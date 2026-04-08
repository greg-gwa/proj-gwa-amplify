import json
import logging
import uuid
from datetime import datetime, timezone

import anthropic
from src.db import get_pool

logger = logging.getLogger(__name__)

client = anthropic.Anthropic()

SYSTEM_PROMPT = """You are a political ad spending extraction engine for Amplify, a competitive intelligence platform.

You receive emails (with attachment content) from TV/radio station representatives containing political ad buy information. Extract all structured spending data.

Rules:
- Extract EVERY buy/order mentioned
- Common fields: estimate number (follows "est" or "Est"), advertiser/spender name, agency, flight dates, spot length, dollar totals
- Break down by station — each station is a separate line item
- Capture media market for each station
- Note if a buy is marked as "REVISED"
- Extract station rep contact info (name, email, phone)
- If multiple buys for different spenders appear (e.g., a master order list), extract ALL of them
- Classify the spender: type (PAC, Campaign Committee, Party, Issue Org, Super PAC, Unknown), party (Democrat, Republican, Nonpartisan, Unknown)
- Extract daypart/rotation detail when available: program name, daypart label (Early Morning, Daytime, Prime, Late News, Weekend, Overnight, etc.), days of week, time window (24h format), rate per spot, spots per week, total spots. Omit the dayparts array if the sheet only has weekly totals with no time/program breakdown.
- Set confidence 0.0-1.0

Return valid JSON:
{
  "buys": [
    {
      "estimate_number": "14510",
      "spender_name": "One Giant Leap PAC",
      "spender_type": "PAC",
      "spender_party": "Democrat",
      "agency": "Sage Media Planning & Placement",
      "flight_start": "2025-05-27",
      "flight_end": "2025-06-02",
      "spot_length_seconds": 30,
      "is_revision": false,
      "confidence": 0.95,
      "lines": [
        {
          "station_call_sign": "WABC",
          "network": "ABC",
          "market_name": "New York, NY",
          "total_dollars": 126200.00,
          "weekly_breakdown": [
            {"week_start": "2025-05-27", "dollars": 126200.00}
          ],
          "dayparts": [
            {
              "daypart": "Early Morning News",
              "program": "Eyewitness News",
              "days": "M-F",
              "time_start": "05:00",
              "time_end": "07:00",
              "rate_per_spot": 150.00,
              "spots_per_week": 10,
              "total_spots": 20,
              "total_dollars": 3000.00
            }
          ]
        }
      ],
      "contacts": [
        {
          "name": "Nick Brown",
          "title": "Account Executive",
          "company": "Disney Advertising",
          "email": "nick.brown@disney.com",
          "phone": "(856) 381-6545"
        }
      ]
    }
  ],
  "meta": {
    "is_political_ad_buy": true,
    "total_buys": 1,
    "total_dollars": 126200.00
  }
}

If the email does NOT contain political ad buy information, return:
{"buys": [], "meta": {"is_political_ad_buy": false}}"""


def _normalize_spender_name(name: str) -> str:
    """Normalize spender name for dedup matching."""
    return " ".join(name.strip().upper().split())


async def _get_or_create_spender(
    conn, name: str, agency: str | None, spender_type: str | None, party: str | None, now: datetime
) -> uuid.UUID:
    """INSERT ... ON CONFLICT for spender dedup. Returns spender_id."""
    spender_id = uuid.uuid4()
    row = await conn.fetchrow(
        """INSERT INTO spenders (id, name, type, agency, party, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $6)
           ON CONFLICT ((UPPER(TRIM(name)))) DO UPDATE SET updated_at = $6
           RETURNING id""",
        spender_id, name.strip(), spender_type, agency, party, now,
    )
    if row:
        return row["id"]
    # Fallback: look up by normalized name
    row = await conn.fetchrow(
        "SELECT id FROM spenders WHERE UPPER(TRIM(name)) = $1 LIMIT 1",
        _normalize_spender_name(name),
    )
    return row["id"] if row else spender_id


def _parse_date(val):
    """Convert date string to date object for asyncpg."""
    from datetime import date as date_cls
    if not val:
        return None
    if isinstance(val, date_cls):
        return val
    try:
        return date_cls.fromisoformat(str(val)[:10])
    except (ValueError, TypeError):
        return None


async def extract_buy(full_content: str, email_id: str) -> dict:
    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=8192,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"Extract all political ad buys from this email:\n\n{full_content}"}],
        )
        content = response.content[0].text

        import re
        match = re.search(r"```json?\s*([\s\S]*?)```", content)
        parsed = json.loads(match.group(1).strip() if match else content)

    except Exception as e:
        logger.error(f"Buy extraction failed: {e}")
        return {"buy_count": 0}

    if not parsed.get("meta", {}).get("is_political_ad_buy", False):
        return {"buy_count": 0}

    now = datetime.now(timezone.utc)
    buy_count = 0
    pool = await get_pool()

    async with pool.acquire() as conn:
        for buy in parsed.get("buys", []):
            buy_id = uuid.uuid4()

            # Deduplicated spender lookup/creation
            spender_name = buy.get("spender_name", "Unknown")
            spender_id = await _get_or_create_spender(
                conn,
                name=spender_name,
                agency=buy.get("agency"),
                spender_type=buy.get("spender_type"),
                party=buy.get("spender_party"),
                now=now,
            )

            # Calculate total
            total = sum(line.get("total_dollars", 0) for line in buy.get("lines", []))

            # Insert buy
            await conn.execute(
                """INSERT INTO buys (id, estimate_number, spender_id, spender_name, agency,
                       flight_start, flight_end, spot_length_seconds, total_dollars, status,
                       is_revision, source_email_id, source_format, extraction_confidence,
                       raw_extraction_json, created_at, updated_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)""",
                buy_id,
                buy.get("estimate_number"),
                spender_id,
                spender_name,
                buy.get("agency"),
                _parse_date(buy.get("flight_start")),
                _parse_date(buy.get("flight_end")),
                buy.get("spot_length_seconds", 30),
                total,
                "new",
                buy.get("is_revision", False),
                uuid.UUID(email_id),
                "email",
                buy.get("confidence"),
                json.dumps(buy),
                now,
            )

            # Insert buy lines
            for line in buy.get("lines", []):
                line_id = uuid.uuid4()
                await conn.execute(
                    """INSERT INTO buy_lines (id, buy_id, station_call_sign, market_name,
                           network, spot_length_seconds, total_dollars, flight_start,
                           flight_end, created_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
                    line_id, buy_id,
                    line.get("station_call_sign"),
                    line.get("market_name"),
                    line.get("network"),
                    buy.get("spot_length_seconds", 30),
                    line.get("total_dollars"),
                    _parse_date(buy.get("flight_start")),
                    _parse_date(buy.get("flight_end")),
                    now,
                )

                # Insert weekly breakdown
                for week in line.get("weekly_breakdown", []):
                    await conn.execute(
                        """INSERT INTO buy_line_weeks (id, buy_line_id, week_start, week_end,
                               dollars, spots, created_at)
                           VALUES ($1,$2,$3,$4,$5,$6,$7)""",
                        uuid.uuid4(), line_id,
                        _parse_date(week.get("week_start")),
                        _parse_date(week.get("week_end")),
                        week.get("dollars"),
                        week.get("spots"),
                        now,
                    )

                # Insert daypart/rotation detail
                for dp in line.get("dayparts", []):
                    await conn.execute(
                        """INSERT INTO buy_line_dayparts (id, buy_line_id, daypart, program,
                               days, time_start, time_end, rate_per_spot, spots_per_week,
                               total_spots, total_dollars, created_at)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)""",
                        uuid.uuid4(), line_id,
                        dp.get("daypart"),
                        dp.get("program"),
                        dp.get("days"),
                        dp.get("time_start"),
                        dp.get("time_end"),
                        dp.get("rate_per_spot"),
                        dp.get("spots_per_week"),
                        dp.get("total_spots"),
                        dp.get("total_dollars"),
                        now,
                    )

            # Insert contacts (dedup by email via ON CONFLICT)
            for contact in buy.get("contacts", []):
                email_addr = contact.get("email")
                if not email_addr:
                    continue
                try:
                    await conn.execute(
                        """INSERT INTO contacts (id, name, title, company, email, phone, created_at)
                           VALUES ($1,$2,$3,$4,$5,$6,$7)
                           ON CONFLICT (email) DO NOTHING""",
                        uuid.uuid4(),
                        contact.get("name"),
                        contact.get("title"),
                        contact.get("company"),
                        email_addr,
                        contact.get("phone"),
                        now,
                    )
                except Exception:
                    pass

            buy_count += 1

            # Try to match this buy to existing FCC radar filings
            try:
                await _match_buy_to_filings(conn, buy_id, spender_name, buy.get("lines", []), buy.get("flight_start"), buy.get("flight_end"), total)
            except Exception as e:
                logger.warning(f"Radar matching failed for buy {buy_id}: {e}")

    return {"buy_count": buy_count}


async def _match_buy_to_filings(conn, buy_id, spender_name: str, lines: list, flight_start, flight_end, total_dollars):
    """Match a newly inserted buy against existing radar_items (FCC filings)."""
    if not spender_name:
        return

    norm_name = spender_name.strip().upper()

    # Get station call signs from buy lines
    stations = [l.get("station_call_sign") for l in lines if l.get("station_call_sign")]

    # Build query — match on spender name similarity + station + date overlap
    for station in stations:
        if not station:
            continue

        # Try exact spender name match + station
        matches = await conn.fetch(
            """SELECT id, spender_name, flight_start, flight_end, total_dollars, status
               FROM radar_items
               WHERE station_call_sign = $1
                 AND status IN ('new', 'likely_match')
                 AND (
                   UPPER(TRIM(spender_name)) = $2
                   OR similarity(UPPER(spender_name), $2) > 0.5
                 )
               ORDER BY detected_at DESC
               LIMIT 5""",
            station.upper(), norm_name,
        )

        for m in matches:
            match_points = 2  # spender + station already matched

            # Check date overlap if both have dates
            if flight_start and m["flight_start"]:
                from datetime import timedelta
                fs = m["flight_start"]
                fe = m["flight_end"] or fs
                buy_fs = datetime.strptime(flight_start, "%Y-%m-%d").date() if isinstance(flight_start, str) else flight_start
                buy_fe = datetime.strptime(flight_end, "%Y-%m-%d").date() if isinstance(flight_end, str) and flight_end else buy_fs
                # Overlap with 3-day tolerance
                if buy_fs <= fe + timedelta(days=3) and buy_fe >= fs - timedelta(days=3):
                    match_points += 1

            # Check dollar amount within 15% (accounts for gross vs net)
            if total_dollars and m["total_dollars"]:
                ratio = float(total_dollars) / float(m["total_dollars"]) if float(m["total_dollars"]) > 0 else 0
                if 0.75 <= ratio <= 1.25:
                    match_points += 1

            # Require at least 3 points for any match (spender + station + dates or dollars)
            # Spender + station alone (2 points) is not enough — too many false positives
            if match_points >= 4:
                await conn.execute(
                    """UPDATE radar_items SET status = 'matched_to_buy', matched_buy_id = $1, updated_at = NOW()
                       WHERE id = $2""",
                    buy_id, m["id"],
                )
                logger.info(f"Matched radar item {m['id']} to buy {buy_id} (spender={spender_name}, station={station}, points={match_points})")
            elif match_points >= 3:
                await conn.execute(
                    """UPDATE radar_items SET status = 'likely_match', matched_buy_id = $1, updated_at = NOW()
                       WHERE id = $2 AND status = 'new'""",
                    buy_id, m["id"],
                )
                logger.info(f"Likely match: radar item {m['id']} to buy {buy_id} (points={match_points})")
