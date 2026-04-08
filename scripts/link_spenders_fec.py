#!/usr/bin/env python3
"""
Link spenders to FEC committees via fuzzy name matching.

For each spender without a fec_id, fuzzy-matches spender.name against
fec_committees.cmte_name using rapidfuzz (JaroWinkler + token_set_ratio).
When match confidence >= 0.80:
  - Sets spenders.fec_id = fec_committees.cmte_id
  - Sets spenders.party from committee if spenders.party is NULL

Through fec_committees.cand_id this links to fec_candidates.
"""

import asyncio
import logging
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "services", "ingest"))

import asyncpg
from rapidfuzz import fuzz
from rapidfuzz.distance import JaroWinkler

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("link_spenders_fec")

# Same normalization as match_radar.py
_STRIP_SUFFIXES = [
    "FOR SENATE", "FOR CONGRESS", "FOR MARYLAND", "FOR GOVERNOR",
    "FOR HOUSE", "FOR PRESIDENT", "FOR AMERICA", "FOR VIRGINIA",
    "COMMITTEE", "CMTE", "POLITICAL ACTION COMMITTEE",
    "PAC", "SUPER PAC", "INC", "LLC", "LLP", "CORP", "CORPORATION",
    "THE", "OF",
]

_SUFFIX_PATTERN = re.compile(
    r'\b(?:' + '|'.join(re.escape(s) for s in _STRIP_SUFFIXES) + r')\b',
    re.IGNORECASE,
)

# FEC party code → readable party
PARTY_MAP = {
    "DEM": "Democrat",
    "REP": "Republican",
    "LIB": "Libertarian",
    "GRE": "Green",
    "IND": "Independent",
    "NNE": "Nonpartisan",
}


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
    dsn = os.environ.get("DATABASE_URL")
    if not dsn:
        print("ERROR: Set DATABASE_URL")
        sys.exit(1)

    conn = await asyncpg.connect(dsn=dsn)

    # Get spenders without fec_id
    spenders = await conn.fetch("""
        SELECT id, name, party
        FROM spenders
        WHERE fec_id IS NULL OR fec_id = ''
        ORDER BY name
    """)

    # Pre-load all FEC committees into memory for fast matching
    committees = await conn.fetch("""
        SELECT cmte_id, cmte_name, cmte_party, cand_id
        FROM fec_committees
        WHERE cmte_name IS NOT NULL AND cmte_name != ''
    """)

    logger.info(f"Matching {len(spenders)} spenders against {len(committees)} FEC committees")

    stats = {
        "total": len(spenders),
        "matched": 0,
        "party_set": 0,
        "unmatched": 0,
    }
    unmatched_names = []

    for i, sp in enumerate(spenders):
        best_cmte = None
        best_score = 0.0

        for cmte in committees:
            score = _score_names(sp["name"], cmte["cmte_name"])
            if score > best_score:
                best_score = score
                best_cmte = cmte

        if best_cmte and best_score >= 0.80:
            # Set fec_id
            await conn.execute(
                "UPDATE spenders SET fec_id = $1, updated_at = NOW() WHERE id = $2",
                best_cmte["cmte_id"],
                sp["id"],
            )
            stats["matched"] += 1

            # Set party if null
            if not sp["party"] and best_cmte["cmte_party"]:
                party = PARTY_MAP.get(best_cmte["cmte_party"], best_cmte["cmte_party"])
                await conn.execute(
                    "UPDATE spenders SET party = $1 WHERE id = $2 AND party IS NULL",
                    party,
                    sp["id"],
                )
                stats["party_set"] += 1

            logger.info(
                f"  Matched: '{sp['name']}' → {best_cmte['cmte_id']} "
                f"'{best_cmte['cmte_name']}' (score={best_score:.3f})"
            )
        else:
            stats["unmatched"] += 1
            unmatched_names.append((sp["name"], best_score if best_cmte else 0.0))

        if (i + 1) % 50 == 0:
            logger.info(f"  Progress: {i+1}/{stats['total']}")

    await conn.close()

    logger.info(f"\n{'='*60}")
    logger.info("FEC LINKAGE COMPLETE")
    logger.info(f"{'='*60}")
    logger.info(f"Total spenders:      {stats['total']}")
    logger.info(f"Matched to FEC:      {stats['matched']}")
    logger.info(f"Party backfilled:    {stats['party_set']}")
    logger.info(f"Unmatched:           {stats['unmatched']}")

    if unmatched_names:
        # Sort by best score descending to show near-misses first
        unmatched_names.sort(key=lambda x: x[1], reverse=True)
        logger.info(f"\nTop unmatched spenders (with best score):")
        for name, score in unmatched_names[:20]:
            logger.info(f"  {score:.3f}  {name}")


if __name__ == "__main__":
    asyncio.run(main())
