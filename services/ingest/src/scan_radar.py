"""
FCC Radar Scanner — scans FCC political filings for watched stations,
deduplicates, parses PDFs, matches against known buys, and stores radar items.
"""

import json
import logging
import uuid
from datetime import datetime, timedelta, timezone, date

from google.cloud import storage as gcs

from src.fcc_client import FCCClient, parse_fcc_timestamp
from src.parse_filing import parse_filing_pdf
from src.match_radar import match_to_spender, match_to_buy
from src.build_monitors import create_monitors_for_contract

GCS_BUCKET = "amplify-raw-emails"
GCS_CLIENT = None

def _get_gcs():
    global GCS_CLIENT
    if GCS_CLIENT is None:
        GCS_CLIENT = gcs.Client(project="proj-amplify")
    return GCS_CLIENT

async def _store_filing_pdf(pdf_bytes: bytes, call_sign: str, file_manager_id: str) -> str:
    """Store a filing PDF in GCS, return the storage path."""
    path = f"filings/{call_sign}/{file_manager_id}.pdf"
    try:
        bucket = _get_gcs().bucket(GCS_BUCKET)
        blob = bucket.blob(path)
        blob.upload_from_string(pdf_bytes, content_type="application/pdf")
        logger.info(f"Stored filing PDF: gs://{GCS_BUCKET}/{path} ({len(pdf_bytes)} bytes)")
    except Exception as e:
        logger.error(f"Failed to store filing PDF: {e}")
    return path

logger = logging.getLogger(__name__)

DEFAULT_WATCH_CONFIG = {
    "market_ids": [],  # UUIDs from markets table
    "scan_interval_hours": 1,
    "lookback_hours": 6,
}


async def _ensure_watch_config(conn) -> dict:
    """Load watch config from radar_config, seed default if missing."""
    # Try new 'watch_config' key first
    row = await conn.fetchrow(
        "SELECT value FROM radar_config WHERE key = $1", "watch_config"
    )
    if row:
        return json.loads(row["value"]) if isinstance(row["value"], str) else row["value"]

    # Fallback: migrate from old 'watch_stations' key
    old_row = await conn.fetchrow(
        "SELECT value FROM radar_config WHERE key = $1", "watch_stations"
    )
    if old_row:
        config = json.loads(old_row["value"]) if isinstance(old_row["value"], str) else old_row["value"]
        # If it has the old 'stations' key, keep backward compat
        return config

    # Seed default config
    await conn.execute(
        """INSERT INTO radar_config (id, key, value, updated_at)
           VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (key) DO NOTHING""",
        uuid.uuid4(),
        "watch_config",
        json.dumps(DEFAULT_WATCH_CONFIG),
        datetime.now(timezone.utc),
    )
    logger.info("Seeded default watch_config")
    return DEFAULT_WATCH_CONFIG


async def _resolve_markets_to_stations(conn, config: dict) -> list[str]:
    """Resolve watched markets to station call signs via FK joins."""
    market_ids = config.get("market_ids", [])
    
    # Also support legacy 'markets' key (string-based) for backward compat
    legacy_markets = config.get("markets", [])
    
    stations = []
    
    if market_ids:
        # Proper FK join
        rows = await conn.fetch(
            "SELECT DISTINCT s.call_sign FROM stations s WHERE s.market_id = ANY($1::uuid[])",
            market_ids,
        )
        stations = [r["call_sign"] for r in rows]
        logger.info(f"Resolved {len(market_ids)} market IDs → {len(stations)} stations")
    elif legacy_markets:
        # Fallback: string matching (deprecated)
        for market in legacy_markets:
            rows = await conn.fetch(
                "SELECT DISTINCT s.call_sign FROM stations s JOIN markets m ON s.market_id = m.id WHERE m.dma_name ILIKE $1",
                f"%{market}%",
            )
            found = [r["call_sign"] for r in rows]
            if found:
                logger.info(f"Market '{market}' → {len(found)} stations")
                stations.extend(found)
            else:
                logger.warning(f"No stations found for market: {market}")
    
    return list(dict.fromkeys(stations))  # dedupe, preserve order


def _parse_date(val) -> date | None:
    """Parse a date string into a date object."""
    if not val:
        return None
    if isinstance(val, date):
        return val
    try:
        return date.fromisoformat(str(val)[:10])
    except (ValueError, TypeError):
        return None


async def scan(
    conn,
    stations: list[str] | None = None,
    markets: list[str] | None = None,
    lookback_hours: int | None = None,
) -> dict:
    """
    Run a full FCC radar scan cycle.

    Args:
        conn: asyncpg connection
        stations: override station list (default: from config)
        markets: override market/DMA list — resolved to stations via DB
        lookback_hours: override lookback window (default: from config)

    Returns:
        Summary dict with scan stats.
    """
    now = datetime.now(timezone.utc)
    scan_id = uuid.uuid4()

    # Record scan start
    await conn.execute(
        "INSERT INTO radar_scans (id, started_at) VALUES ($1, $2)",
        scan_id, now,
    )

    stats = {
        "scan_id": str(scan_id),
        "stations_scanned": 0,
        "filings_found": 0,
        "new_items": 0,
        "matched_items": 0,
        "errors": 0,
        "error_details": [],
    }

    try:
        # Load config
        config = await _ensure_watch_config(conn)
        lb_hours = lookback_hours or config.get("lookback_hours", 24)
        cutoff = now - timedelta(hours=lb_hours)

        # Scan ALL stations in the database — build the complete national picture.
        # Watchlist is used for alerts/display filtering, not scan scope.
        if stations:
            # Explicit override (for testing)
            all_stations = stations
        else:
            # Get all stations with FCC entity IDs
            rows = await conn.fetch(
                "SELECT call_sign FROM stations WHERE fcc_entity_id IS NOT NULL ORDER BY call_sign"
            )
            all_stations = [r["call_sign"] for r in rows]

        watch_stations = all_stations

        logger.info(f"Radar scan starting: {len(watch_stations)} stations, lookback={lb_hours}h")

        async with FCCClient() as fcc:
            for call_sign in watch_stations:
                try:
                    await _scan_station(conn, fcc, call_sign, cutoff, now, stats)
                    stats["stations_scanned"] += 1
                except Exception as e:
                    stats["errors"] += 1
                    stats["error_details"].append(f"{call_sign}: {e}")
                    logger.exception(f"Error scanning station {call_sign}")

    except Exception as e:
        stats["errors"] += 1
        stats["error_details"].append(f"Scan-level error: {e}")
        logger.exception("Radar scan failed")

    # Record scan completion
    error_text = "\n".join(stats["error_details"]) if stats["error_details"] else None
    await conn.execute(
        """UPDATE radar_scans
           SET completed_at = $2, stations_scanned = $3, filings_found = $4,
               new_items = $5, matched_items = $6, errors = $7, error_details = $8
           WHERE id = $1""",
        scan_id, datetime.now(timezone.utc),
        stats["stations_scanned"], stats["filings_found"],
        stats["new_items"], stats["matched_items"],
        stats["errors"], error_text,
    )

    logger.info(
        f"Radar scan complete: {stats['stations_scanned']} stations, "
        f"{stats['filings_found']} filings, {stats['new_items']} new, "
        f"{stats['matched_items']} matched, {stats['errors']} errors"
    )
    return stats


async def _scan_station(conn, fcc: FCCClient, call_sign: str, cutoff: datetime, now: datetime, stats: dict):
    """Scan a single station for new political filings."""
    # Use stored entity ID — no FCC API call needed
    row = await conn.fetchrow(
        "SELECT fcc_entity_id, market_id, city, state FROM stations WHERE call_sign = $1", call_sign
    )
    if not row or not row["fcc_entity_id"]:
        # Fallback: look up via FCC API
        station_info = await fcc.search_station(call_sign)
        if not station_info:
            stats["errors"] += 1
            stats["error_details"].append(f"{call_sign}: not found")
            return
        entity_id = station_info["entity_id"]
    else:
        entity_id = row["fcc_entity_id"]

    # Get political filings
    filings = await fcc.get_political_filings(entity_id)
    logger.info(f"Station {call_sign}: {len(filings)} total filings")

    for filing in filings:
        try:
            # Filter by create_ts — only process recent filings
            create_ts = parse_fcc_timestamp(filing.get("create_ts", ""))
            if create_ts and create_ts < cutoff:
                continue

            stats["filings_found"] += 1
            file_manager_id = str(filing.get("file_manager_id", ""))
            folder_id = str(filing.get("folder_id", ""))

            if not file_manager_id:
                continue

            # Build a stable filing ID for dedup
            fcc_filing_id = f"{entity_id}:{file_manager_id}"

            # Check if we already have this filing
            existing = await conn.fetchval(
                "SELECT id FROM radar_items WHERE fcc_filing_id = $1",
                fcc_filing_id,
            )
            if existing:
                continue

            # Extract metadata from folder path (fast path — no PDF needed)
            advertiser_name = filing.get("advertiser_name") or "Unknown"
            office_type = filing.get("office_type")
            race_type = filing.get("race_type")

            # Build filing URL
            filing_url = f"https://publicfiles.fcc.gov/api/manager/download/{folder_id}/{file_manager_id}.pdf"

            # Try to match spender from folder path name first
            spender_match = await match_to_spender(conn, advertiser_name)

            # Determine status and whether we need the expensive PDF parse
            status = "new"
            matched_buy_id = None
            flight_start = None
            flight_end = None
            total_dollars = None

            if spender_match and spender_match["confidence"] >= 0.8:
                # Try to match against existing buys (without PDF data, limited match)
                buy_match = await match_to_buy(
                    conn,
                    spender_name=spender_match["name"],
                    station=call_sign,
                    flight_start=None,
                    flight_end=None,
                    dollars=None,
                )
                if buy_match and buy_match["match_points"] >= 3:
                    status = "matched_to_buy"
                    matched_buy_id = buy_match["buy_id"]
                    stats["matched_items"] += 1
                elif buy_match and buy_match["match_points"] >= 2:
                    status = "likely_match"
                    matched_buy_id = buy_match["buy_id"]
                    stats["matched_items"] += 1

            # If not matched, try PDF parse for more detail (expensive path)
            filing_storage_path = None
            if status == "new" and folder_id and file_manager_id:
                pdf_bytes = await fcc.download_filing_pdf(folder_id, file_manager_id)
                if pdf_bytes:
                    # Store PDF in GCS
                    filing_storage_path = await _store_filing_pdf(pdf_bytes, call_sign, file_manager_id)
                    parsed = await parse_filing_pdf(pdf_bytes)
                    confidence = parsed.get("confidence", 0)

                    if confidence >= 0.3:
                        # Update with parsed data
                        advertiser_name = parsed.get("advertiser_name") or advertiser_name
                        flight_start = _parse_date(parsed.get("flight_start"))
                        flight_end = _parse_date(parsed.get("flight_end"))
                        total_dollars = parsed.get("total_dollars")

                        # Re-match with richer data
                        spender_match = await match_to_spender(conn, advertiser_name)
                        if spender_match:
                            buy_match = await match_to_buy(
                                conn,
                                spender_name=spender_match["name"],
                                station=call_sign,
                                flight_start=flight_start,
                                flight_end=flight_end,
                                dollars=total_dollars,
                            )
                            if buy_match and buy_match["match_points"] >= 3:
                                status = "matched_to_buy"
                                matched_buy_id = buy_match["buy_id"]
                                stats["matched_items"] += 1
                            elif buy_match and buy_match["match_points"] >= 2:
                                status = "likely_match"
                                matched_buy_id = buy_match["buy_id"]
                                stats["matched_items"] += 1

            # Use stored station data for market info
            market_name = (
                f"{row['city']}, {row['state']}" if row and row.get("city") else None
            )
            station_market_id = row["market_id"] if row else None

            # Determine spender type from filing path
            spender_type = None
            if spender_match:
                spender_type = spender_match.get("type")
            elif office_type == "Non-Candidate":
                spender_type = "Issue Org"

            # Insert radar item
            await conn.execute(
                """INSERT INTO radar_items
                   (id, fcc_filing_id, station_call_sign, market_name, spender_name,
                    spender_type, flight_start, flight_end, total_dollars, filing_url,
                    filing_storage_path, status, matched_buy_id, station_id, market_id,
                    detected_at, created_at, updated_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16,$16)""",
                uuid.uuid4(),
                fcc_filing_id,
                call_sign,
                market_name,
                advertiser_name,
                spender_type,
                flight_start,
                flight_end,
                total_dollars,
                filing_url,
                filing_storage_path,
                status,
                matched_buy_id,
                (await conn.fetchval("SELECT id FROM stations WHERE call_sign = $1", call_sign)),
                station_market_id,
                now,
            )
            stats["new_items"] += 1
            logger.info(
                f"New radar item: {advertiser_name} @ {call_sign} — status={status}"
            )

            # Immediately parse the PDF for this new filing
            if folder_id and file_manager_id and not total_dollars:
                try:
                    pdf_bytes = await fcc.download_filing_pdf(folder_id, file_manager_id)
                    if pdf_bytes:
                        parsed = await parse_filing_pdf(pdf_bytes)
                        doc_type = parsed.get("document_type", "OTHER")
                        p_dollars = parsed.get("total_dollars") if doc_type in ("CONTRACT", "ORDER") else None
                        p_flight_start = _parse_date(parsed.get("flight_start")) if doc_type in ("CONTRACT", "ORDER") else None
                        p_flight_end = _parse_date(parsed.get("flight_end")) if doc_type in ("CONTRACT", "ORDER") else None
                        p_party = parsed.get("party")

                        rid = await conn.fetchval(
                            "SELECT id FROM radar_items WHERE fcc_filing_id = $1", fcc_filing_id
                        )
                        if rid:
                            import json as _json
                            await conn.execute('''
                                UPDATE radar_items SET
                                    pdf_downloaded = TRUE, pdf_parsed = TRUE, parsed_at = $2,
                                    document_type = $3, total_dollars = $4,
                                    flight_start = $5, flight_end = $6,
                                    spender_type = COALESCE($7, spender_type),
                                    parsed_data = $8::jsonb
                                WHERE id = $1
                            ''', rid, now, doc_type, p_dollars, p_flight_start, p_flight_end,
                                p_party, _json.dumps(parsed))
                            if doc_type in ("CONTRACT", "ORDER") and p_dollars:
                                logger.info(f"  Parsed: {doc_type} ${p_dollars:,.2f} {p_flight_start}→{p_flight_end}")
                            else:
                                logger.info(f"  Parsed: {doc_type}")
                except Exception as e:
                    logger.warning(f"  Parse failed for {call_sign}/{file_manager_id}: {e}")

        except Exception as e:
            stats["errors"] += 1
            stats["error_details"].append(f"{call_sign}/{filing.get('file_manager_id')}: {e}")
            logger.exception(f"Error processing filing for {call_sign}")
