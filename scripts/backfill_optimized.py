#!/usr/bin/env python3
"""
Optimized backfill: match all unmatched radar_items to buys in bulk.

Strategy:
1. Seed spender_aliases with obvious variants
2. Load all 52 spenders + aliases into memory
3. Get all distinct spender_names from unmatched radar_items (74K)
4. Match each name against spenders using rapidfuzz (in-memory, zero DB round-trips)
5. Build name→spender_id mapping
6. For matched names, batch-match against buys (station + date + dollars)
7. Bulk UPDATE radar_items by name
"""

import asyncio
import logging
import os
import re
import sys
import time
from datetime import timedelta

import asyncpg
from rapidfuzz import fuzz
from rapidfuzz.distance import JaroWinkler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("backfill_optimized")

# ── Alias seeds ──────────────────────────────────────────────────────────────
# Format: (alias_text, canonical_spender_name)
ALIAS_SEEDS = [
    # SLF PAC variants
    ("Senate Leadership Fund", "SLF PAC"),
    ("SENATE LEADERSHIP FUND", "SLF PAC"),
    ("SLF PAC - SENATE LEADERSHIP FUND", "SLF PAC"),
    ("SLF PAC fka Senate Leadership Fund", "SLF PAC"),
    ("ISS/ SLF PAC", "SLF PAC"),
    ("ISS/SLF PAC", "SLF PAC"),
    ("POL/SLF PAC", "SLF PAC"),
    ("SLF Pac", "SLF PAC"),
    # Vote Vets variants  
    ("VoteVets", "Vote Vets"),
    ("VOTEVETS", "Vote Vets"),
    ("Vote Vets PAC", "Vote Vets"),
    ("VOTE VETS", "Vote Vets"),
    # Virginians
    ("Virginians for Fair Elections", "Virginians for Fair Maps"),
    ("Virginians For Fair Elections", "Virginians for Fair Maps"),
    ("VIRGINIANS FOR FAIR MAPS", "Virginians for Fair Maps"),
    ("Virginians for Fair Maps RC", "Virginians for Fair Maps"),
    # Andy Barr
    ("ANDY BARR FOR SENATE", "Andy Barr for Senate"),
    ("Barr/Republican/US Senate", "Andy Barr for Senate"),
    ("Andy Barr for KY", "Andy Barr for Senate"),
    # Barry Moore
    ("Barry Moore", "Barry Moore for US Senate"),
    ("BARRY MOORE FOR U.S. SENATE", "Barry Moore for US Senate"),
    ("BARRY MOORE - SEN - AL", "Barry Moore for US Senate"),
    ("POL/Barry Moore/US Senate/AL/Rep", "Barry Moore for US Senate"),
    ("Barry Moore for AL", "Barry Moore for US Senate"),
    ("Barry Moore for Senate AL", "Barry Moore for US Senate"),
    # KY PAC
    ("KY PAC 115581", "KY PAC"),
    ("KY PAC - Issue", "KY PAC"),
    ("Kentucky", "Kentucky PAC"),
    ("Kentucky 4th PAC", "Kentucky PAC"),
    # American Conservative Fund
    ("American Conservative Fund PAC", "American Conservative Fund"),
    # Feenstra
    ("Feenstra for Governor", "Randy Feenstra for Governor"),
    ("FEENSTRA FOR GOVERNOR", "Randy Feenstra for Governor"),
    ("IA - Feenstra for Governor", "Randy Feenstra for Governor IA"),
    ("RANDY FEENSTRA FOR GOVERNOR", "Randy Feenstra for Governor"),
    # Rom Reddy
    ("Rom Reddy", "Rom Reddy for Governor"),
    ("Rom Reddy for SC Governor-R", "Rom Reddy for Governor SC"),
    ("POL/Rom Reddy/Governor/SC/Rep", "Rom Reddy for Governor SC"),
    # Mike Mazzei
    ("Mike Mazzei for Governor 2026", "Mike Mazzei for Governor"),
    # Thomas Massie
    ("Massie R US Congress", "Thomas Massie for Congress"),
    ("THOMAS MASSIE FOR CONGRESS", "Thomas Massie for Congress"),
    # Electronic Payment Coalition
    ("ELECTRONIC PAYMENT COALITION", "Electronic Payment Coalition"),
    # John Wahl
    ("John Wahl", "John Wahl for Alabama"),
]

# ── Name normalization ───────────────────────────────────────────────────────
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
_SUFFIX_PATTERN = re.compile(
    r'\b(?:' + '|'.join(re.escape(s) for s in _STRIP_SUFFIXES) + r')\b',
    re.IGNORECASE,
)

def _normalize_for_fuzzy(name: str) -> str:
    n = name.strip().upper()
    n = _SUFFIX_PATTERN.sub("", n)
    n = re.sub(r"[^\w\s]", "", n)
    return " ".join(n.split()).strip()

def _score_names(name_a: str, name_b: str) -> float:
    norm_a = _normalize_for_fuzzy(name_a)
    norm_b = _normalize_for_fuzzy(name_b)
    if not norm_a or not norm_b:
        return 0.0
    jw = JaroWinkler.similarity(norm_a, norm_b)
    tsr = fuzz.token_set_ratio(norm_a, norm_b) / 100.0
    return 0.6 * jw + 0.4 * tsr


async def main():
    db_pass = os.environ.get("DB_PASS")
    if not db_pass:
        print("ERROR: Set DB_PASS")
        sys.exit(1)

    conn = await asyncpg.connect(dsn=f"postgresql://amplify:{db_pass}@35.225.87.123:5432/amplify")
    t0 = time.time()

    # ── Step 1: Seed aliases ─────────────────────────────────────────────────
    logger.info("Step 1: Seeding spender_aliases...")
    spender_map = {}  # name_upper → id
    for row in await conn.fetch("SELECT id, name FROM spenders"):
        spender_map[row["name"].strip().upper()] = row["id"]

    seeded = 0
    for alias_text, canonical_name in ALIAS_SEEDS:
        spender_id = spender_map.get(canonical_name.strip().upper())
        if not spender_id:
            logger.warning(f"Canonical spender not found: '{canonical_name}' — skipping alias '{alias_text}'")
            continue
        try:
            await conn.execute(
                """INSERT INTO spender_aliases (spender_id, alias)
                   VALUES ($1, $2)
                   ON CONFLICT (UPPER(TRIM(alias))) DO NOTHING""",
                spender_id, alias_text,
            )
            seeded += 1
        except Exception as e:
            logger.debug(f"Alias insert skipped: {e}")
    logger.info(f"Seeded {seeded} aliases")

    # ── Step 2: Build in-memory lookup ───────────────────────────────────────
    logger.info("Step 2: Building in-memory spender lookup...")
    
    # Exact lookup: upper(name) → spender row
    exact_lookup = {}
    spenders = await conn.fetch("SELECT id, name, type, party FROM spenders")
    for s in spenders:
        exact_lookup[s["name"].strip().upper()] = dict(s)
    
    aliases = await conn.fetch(
        "SELECT sa.alias, sa.spender_id, s.name, s.type, s.party FROM spender_aliases sa JOIN spenders s ON s.id = sa.spender_id"
    )
    for a in aliases:
        exact_lookup[a["alias"].strip().upper()] = {
            "id": a["spender_id"], "name": a["name"], "type": a["type"], "party": a["party"]
        }

    logger.info(f"Exact lookup entries: {len(exact_lookup)}")
    logger.info(f"Spenders for fuzzy: {len(spenders)}")

    # ── Step 3: Get all distinct unmatched names ─────────────────────────────
    logger.info("Step 3: Fetching distinct unmatched spender names...")
    distinct_names = await conn.fetch("""
        SELECT spender_name, COUNT(*) as cnt
        FROM radar_items
        WHERE status = 'new' AND spender_name IS NOT NULL AND spender_name != ''
        GROUP BY spender_name
    """)
    logger.info(f"Distinct names to match: {len(distinct_names)}")

    # ── Step 4: Match all names in memory ────────────────────────────────────
    logger.info("Step 4: Matching names against spenders (in memory)...")
    
    name_to_spender = {}  # spender_name → {id, name, confidence}
    matched_count = 0
    exact_count = 0
    fuzzy_count = 0

    for row in distinct_names:
        name = row["spender_name"]
        norm = name.strip().upper()
        
        # Exact match (includes aliases)
        if norm in exact_lookup:
            sp = exact_lookup[norm]
            name_to_spender[name] = {"id": sp["id"], "name": sp["name"], "confidence": 1.0}
            exact_count += 1
            matched_count += row["cnt"]
            continue
        
        # Fuzzy match against all spenders
        best_score = 0.0
        best_spender = None
        for s in spenders:
            score = _score_names(name, s["name"])
            if score > best_score:
                best_score = score
                best_spender = s
        
        if best_spender and best_score >= 0.75:
            name_to_spender[name] = {
                "id": best_spender["id"],
                "name": best_spender["name"],
                "confidence": best_score,
            }
            fuzzy_count += 1
            matched_count += row["cnt"]

    logger.info(f"Spender matches: {len(name_to_spender)} names ({exact_count} exact, {fuzzy_count} fuzzy)")
    logger.info(f"Covers {matched_count} radar items")

    # ── Step 5: Load all buys with lines for matching ────────────────────────
    logger.info("Step 5: Loading buys + buy_lines...")
    buys = await conn.fetch("""
        SELECT b.id AS buy_id, b.spender_name, b.flight_start, b.flight_end, b.total_dollars,
               bl.station_call_sign, bl.total_dollars AS line_dollars
        FROM buys b
        JOIN buy_lines bl ON bl.buy_id = b.id
    """)
    
    # Index buys by normalized spender name
    buy_index = {}  # upper(spender_name) → [buy rows]
    for b in buys:
        key = b["spender_name"].strip().upper()
        buy_index.setdefault(key, []).append(b)
    
    logger.info(f"Buy lines loaded: {len(buys)} across {len(buy_index)} spender groups")

    # ── Step 6: Match radar items to buys (batch by name) ────────────────────
    logger.info("Step 6: Matching radar items to buys...")
    
    # Get all unmatched radar items that have a spender match
    matched_names_list = list(name_to_spender.keys())
    
    # Process in batches of 500 names
    total_matched_to_buy = 0
    total_likely = 0
    total_spender_only = 0
    batch_size = 500
    
    for batch_start in range(0, len(matched_names_list), batch_size):
        batch_names = matched_names_list[batch_start:batch_start + batch_size]
        
        items = await conn.fetch("""
            SELECT id, spender_name, station_call_sign, flight_start, flight_end, total_dollars
            FROM radar_items
            WHERE status = 'new'
              AND spender_name = ANY($1::text[])
        """, batch_names)
        
        updates_buy = []     # (status, buy_id, item_id)
        updates_likely = []
        
        for item in items:
            sp = name_to_spender[item["spender_name"]]
            canonical_name = sp["name"].strip().upper()
            
            # Try to match to a specific buy
            candidate_buys = buy_index.get(canonical_name, [])
            if not candidate_buys:
                # No buys for this spender — just mark spender-matched but leave as 'new'
                total_spender_only += 1
                continue
            
            best_buy = None
            best_points = 0
            
            station = (item["station_call_sign"] or "").strip().upper()
            clean_station = station.replace("-TV", "").replace("-FM", "").replace("-AM", "").replace("-DT", "")
            
            for b in candidate_buys:
                points = 1  # spender match
                
                # Station match
                b_station = (b["station_call_sign"] or "").strip().upper()
                b_clean = b_station.replace("-TV", "").replace("-FM", "").replace("-AM", "").replace("-DT", "")
                if station and (b_station == station or b_clean == clean_station or b_station == clean_station or b_clean == station):
                    points += 1
                
                # Date overlap (±3 days)
                if item["flight_start"] and b["flight_start"]:
                    buy_start = b["flight_start"]
                    buy_end = b["flight_end"] or buy_start
                    filing_start = item["flight_start"]
                    filing_end = item["flight_end"] or filing_start
                    if (filing_start - timedelta(days=3)) <= buy_end and \
                       (filing_end + timedelta(days=3)) >= buy_start:
                        points += 1
                
                # Dollar match (within 10%)
                dollars = float(item["total_dollars"]) if item["total_dollars"] else None
                if dollars and dollars > 0:
                    compare = float(b["line_dollars"] or 0) if station else float(b["total_dollars"] or 0)
                    if compare > 0:
                        ratio = min(dollars, compare) / max(dollars, compare)
                        if ratio >= 0.9:
                            points += 1
                
                if points > best_points:
                    best_points = points
                    best_buy = b
            
            # Threshold: 3 normally, 2 if high-confidence spender + station
            threshold = 3
            if sp["confidence"] >= 0.85 and station:
                threshold = 2
            
            if best_buy and best_points >= 3:
                updates_buy.append((best_buy["buy_id"], item["id"]))
            elif best_buy and best_points >= threshold:
                updates_likely.append((best_buy["buy_id"], item["id"]))
        
        # Bulk update
        if updates_buy:
            await conn.executemany(
                "UPDATE radar_items SET status = 'matched_to_buy', matched_buy_id = $1, updated_at = NOW() WHERE id = $2",
                updates_buy,
            )
            total_matched_to_buy += len(updates_buy)
        
        if updates_likely:
            await conn.executemany(
                "UPDATE radar_items SET status = 'likely_match', matched_buy_id = $1, updated_at = NOW() WHERE id = $2",
                updates_likely,
            )
            total_likely += len(updates_likely)
        
        logger.info(
            f"Batch {batch_start//batch_size + 1}: "
            f"processed {len(items)} items, "
            f"matched_to_buy={len(updates_buy)}, likely={len(updates_likely)}"
        )

    elapsed = time.time() - t0
    
    logger.info(f"\n{'='*60}")
    logger.info("BACKFILL COMPLETE")
    logger.info(f"{'='*60}")
    logger.info(f"Time: {elapsed:.1f}s")
    logger.info(f"Distinct names matched to spender: {len(name_to_spender)} / {len(distinct_names)}")
    logger.info(f"  - Exact: {exact_count}")
    logger.info(f"  - Fuzzy: {fuzzy_count}")
    logger.info(f"Radar items → matched_to_buy: {total_matched_to_buy}")
    logger.info(f"Radar items → likely_match: {total_likely}")
    logger.info(f"Radar items → spender matched but no buy: {total_spender_only}")
    logger.info(f"Aliases seeded: {seeded}")

    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
