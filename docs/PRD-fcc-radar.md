# FCC Radar — Product Requirements Document

**Version:** 0.1
**Date:** April 4, 2026
**Status:** Draft

---

## Overview

FCC Radar is Amplify's early warning system. It automatically scrapes FCC public file data for political ad filings, detects new spending before buy confirmation emails arrive, and surfaces intelligence about competitor activity that may not come through station rep channels at all.

**The insight:** Station reps email buy confirmations to their clients. But *every* political ad buy must be filed with the FCC within 24 hours. By scraping FCC filings directly, Amplify can:

1. **Detect buys before email confirmation** — beat the email pipeline by hours
2. **Catch buys that never get emailed** — opposing campaigns' buys that station reps won't volunteer
3. **Cross-reference filings against known buys** — validate email data, catch discrepancies
4. **Surface dark money / new PAC activity** — unknown spenders filing on relevant stations

---

## Problem Statement

Today, Amplify only knows about ad buys when station reps send email confirmations. This has gaps:

- **Blind spots:** You only see *your client's* buys from friendly reps. Opposing campaigns' buys come late or not at all.
- **Timing:** Emails can lag filings by 24-72 hours.
- **Completeness:** Some stations are slow or inconsistent about sending emails.
- **Dark money:** New PACs and issue orgs file with the FCC but have no relationship with your team.

FCC Radar closes these gaps by going directly to the source.

---

## FCC Political File API

### Data Source

The FCC maintains a public political file database at:
- **API:** `https://publicfiles.fcc.gov/api/`
- **Search endpoint:** `GET /manager/search/entity/{entity_type}.json`
- **Filing endpoint:** `GET /api/manager/search/key/{key}.json`
- **No API key required** — fully public

### What's Available

Every broadcast station (TV/radio) must upload political ad contracts within 24 hours. Each filing contains:

| Field | Description |
|-------|-------------|
| **Station Call Sign** | e.g., WABC, WJLA |
| **Advertiser Name** | The spender (PAC, campaign, etc.) |
| **Order Date** | When the buy was placed |
| **Flight Dates** | Start and end of ad run |
| **Total Amount** | Dollar value of the buy |
| **Filing URL** | Link to the actual contract document (PDF) |
| **Filing Date** | When it was uploaded to FCC |

### Limitations

- **Data quality varies:** Some stations file detailed breakdowns, others upload a scanned PDF with minimal metadata
- **OCR may be needed:** Some filings are scanned images, not text PDFs
- **Filing lag:** Legally required within 24h, but some stations lag by days
- **No universal format:** Each station group has different filing conventions

---

## Architecture

### System Flow

```
┌─────────────────┐
│  FCC Public API  │
│  publicfiles.fcc │
└────────┬────────┘
         │ Poll every 4 hours
         ▼
┌─────────────────┐
│  Radar Scanner  │  Cloud Run Job (scheduled)
│  Python service │
│                 │  1. Query FCC API for target markets/stations
│                 │  2. Detect new filings since last scan
│                 │  3. Extract metadata from filing
│                 │  4. Optionally download + parse filing PDF
│                 │  5. Match against known spenders
│                 │  6. Match against existing buys
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   radar_items   │  Postgres table
│                 │
│  Each filing    │──→ Match engine ──→ Linked to buy? ──→ Status: matched
│  becomes a      │                                   └──→ Status: new (alert!)
│  radar item     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Ops Console   │  Radar tab (already exists)
│   /ops/radar    │  • New filings highlighted
│                 │  • Link to buy / Dismiss actions
│                 │  • Filter by status, market, spender
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Notifications  │  Alert when:
│                 │  • New spender detected on watched station
│                 │  • Large buy (>$100K) on watched market
│                 │  • Filing doesn't match any known buy (gap)
│                 │  • Known opponent increases spend
└─────────────────┘
```

### Components

| Component | Technology | Status |
|-----------|-----------|--------|
| Radar Scanner | Python, Cloud Run Job | 📋 To build |
| FCC API Client | Python `httpx` | 📋 To build |
| Filing PDF Parser | Claude (AI extraction) | 📋 To build |
| Match Engine | SQL + fuzzy match | 📋 To build |
| `radar_items` table | Postgres | ✅ Exists |
| Ops Console Radar tab | Next.js | ✅ Exists (UI shell) |
| Radar API (`/api/radar`) | Next.js API route | ✅ Exists |

---

## Radar Scanner Service

### Scan Strategy

**Watched entities** — configurable per deployment:

```json
{
  "watch_markets": ["Washington, DC", "Richmond-Petersburg, VA", "Norfolk, VA"],
  "watch_stations": ["WJLA", "WTTG", "WUSA", "WRC", "WRIC", "WWBT"],
  "watch_spenders": ["Virginians for Fair Elections", "One Giant Leap PAC"],
  "watch_districts": ["VA-07", "VA-02", "VA-10"]
}
```

**Scan frequency:** Every 4 hours (configurable via Cloud Scheduler or cron)

**Scan window:** Look back 48 hours from last scan to catch late filings

### Scan Process

```python
async def scan():
    # 1. For each watched station, query FCC API for recent filings
    for station in config.watch_stations:
        filings = await fcc_client.get_political_filings(
            call_sign=station,
            since=last_scan_time - timedelta(hours=48)
        )

        for filing in filings:
            # 2. Deduplicate — skip if we've already seen this filing ID
            if await already_tracked(filing.fcc_filing_id):
                continue

            # 3. Extract metadata
            metadata = extract_filing_metadata(filing)

            # 4. Optionally parse the PDF for detailed line items
            if filing.has_document:
                detail = await parse_filing_pdf(filing.document_url)
                metadata.update(detail)

            # 5. Match against known spenders
            spender_match = await match_spender(metadata.advertiser_name)

            # 6. Match against existing buys
            buy_match = await match_buy(
                spender=metadata.advertiser_name,
                station=station,
                flight_start=metadata.flight_start,
                flight_end=metadata.flight_end,
                dollars=metadata.total_dollars
            )

            # 7. Create radar item
            status = "matched_to_buy" if buy_match else "new"
            await insert_radar_item(
                fcc_filing_id=filing.id,
                station_call_sign=station,
                market_name=metadata.market,
                spender_name=metadata.advertiser_name,
                spender_type=spender_match.type if spender_match else None,
                flight_start=metadata.flight_start,
                flight_end=metadata.flight_end,
                total_dollars=metadata.total_dollars,
                filing_url=filing.document_url,
                status=status,
                matched_buy_id=buy_match.id if buy_match else None,
                detected_at=datetime.utcnow()
            )

            # 8. Alert if significant
            if status == "new" and should_alert(metadata):
                await send_alert(metadata)
```

### Match Engine

**Buy matching** — a radar item matches an existing buy if:

| Criterion | Match Logic |
|-----------|-------------|
| Spender | Fuzzy name match (normalized, >85% similarity) |
| Station | Exact call sign match |
| Flight dates | Overlapping date range (±3 days tolerance) |
| Dollars | Within 10% of filed amount |

**Confidence scoring:**
- 4/4 criteria match → `matched_to_buy` (auto-link)
- 3/4 criteria match → `likely_match` (flag for review)
- <3 criteria → `new` (no match, surface as alert)

### Filing PDF Parsing

Some FCC filings contain rich data in the uploaded PDF (full buy orders, rate cards, weekly breakdowns). Claude can extract this:

```python
async def parse_filing_pdf(url: str) -> dict:
    pdf_bytes = await download(url)
    text = extract_pdf_text(pdf_bytes)

    # If text extraction fails (scanned image), use Claude vision
    if not text.strip():
        text = await claude_vision_extract(pdf_bytes)

    # Extract structured data
    result = await claude_extract(
        prompt=FCC_FILING_EXTRACTION_PROMPT,
        content=text
    )
    return result
```

---

## Alert Rules

Configurable per-deployment. Default rules:

| Rule | Trigger | Priority |
|------|---------|----------|
| **New Spender** | Unknown advertiser on a watched station | 🔴 High |
| **Large Buy** | Filing > $100K on watched market | 🔴 High |
| **Unmatched Filing** | Filing on watched station with no corresponding email buy | 🟡 Medium |
| **Opponent Spike** | Known opponent increases weekly spend > 50% | 🟡 Medium |
| **New Market Entry** | Known spender appears on a new station/market | 🟢 Low |
| **Flight Extension** | Existing buy's flight dates extended in new filing | 🟢 Low |

### Alert Delivery

- **Ops Console:** Badge count on Radar tab, sorted by priority
- **Telegram/Email:** Configurable notification for 🔴 High priority
- **Client Portal (future):** Real-time alert feed

---

## Ops Console — Radar Tab

### Existing UI (enhance)

The radar tab already exists with a table view. Enhancements needed:

**Dashboard summary strip:**
- Total new filings (last 24h)
- Unmatched filings count (⚠️)
- Total dollars detected (last 7 days)
- Markets with activity

**Table enhancements:**
- Column: `Source` — link to FCC filing PDF
- Column: `Matched Buy` — link to buy detail if matched
- Action: `Link to Buy` — manual match to existing buy
- Action: `Create Buy` — create a new buy from this filing
- Action: `Dismiss` — mark as irrelevant (with reason)
- Bulk actions: dismiss all expired, link selected to buy

**Filing detail drawer:**
- FCC filing metadata
- Extracted PDF content (if parsed)
- Spender match candidates (if ambiguous)
- Timeline: when filed → when detected → when matched/dismissed

---

## Data Model

### `radar_items` table (already exists)

```sql
CREATE TABLE radar_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fcc_filing_id     TEXT,          -- FCC's unique filing identifier
    station_call_sign TEXT,
    market_name       TEXT,
    spender_name      TEXT,          -- Advertiser name from FCC filing
    spender_type      TEXT,          -- If matched: PAC, Campaign, etc.
    flight_start      DATE,
    flight_end        DATE,
    total_dollars     NUMERIC(14,2),
    filing_url        TEXT,          -- Link to FCC filing document
    status            TEXT,          -- new | matched_to_buy | likely_match | expired | dismissed
    matched_buy_id    UUID,          -- FK to buys if matched
    notes             TEXT,
    detected_at       TIMESTAMPTZ,   -- When our scanner found it
    created_at        TIMESTAMPTZ,
    updated_at        TIMESTAMPTZ
);
```

### New: `radar_config` table

```sql
CREATE TABLE radar_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key             TEXT NOT NULL UNIQUE,  -- e.g., 'watch_stations', 'alert_rules'
    value           JSONB NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);
```

Stores watch lists, alert thresholds, and scan state (last scan timestamp, etc.) as JSON — flexible config without schema changes.

### New: `radar_scans` table

```sql
CREATE TABLE radar_scans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at      TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ,
    stations_scanned INTEGER,
    filings_found   INTEGER,
    new_items       INTEGER,
    matched_items   INTEGER,
    errors          INTEGER,
    error_details   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

Audit trail for each scan run — useful for debugging and monitoring scan health.

---

## Implementation Plan

### Phase 1: FCC API Client + Scanner (1-2 days)
- Build Python FCC API client (`services/ingest/src/fcc_client.py`)
- Build radar scanner (`services/ingest/src/scan_radar.py`)
- Add `/scan` endpoint to ingest service (trigger manually or via Cloud Scheduler)
- Test against live FCC data for Virginia stations
- Create `radar_config` and `radar_scans` tables

### Phase 2: Match Engine (1 day)
- Spender fuzzy matching (normalized name comparison)
- Buy matching (station + dates + dollars overlap)
- Auto-link matched filings, flag likely matches
- Surface unmatched filings as alerts

### Phase 3: Ops Console Enhancements (1 day)
- Summary strip on radar tab
- Filing detail drawer
- Link/Create Buy/Dismiss actions (with API routes)
- Bulk actions

### Phase 4: Alerts + Notifications (1 day)
- Alert rule engine
- Telegram notification for high-priority alerts
- Alert history in ops console

### Phase 5: PDF Parsing (stretch)
- Download and parse FCC filing PDFs via Claude
- Extract detailed line items from filings
- Backfill radar items with parsed data

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Filing detection latency | < 6 hours from FCC upload |
| Auto-match rate | > 70% of filings matched to existing buys |
| False positive rate | < 10% of "new" alerts are actually known buys |
| Coverage | 100% of filings on watched stations detected |
| Scan uptime | > 99% (no missed scan windows) |

---

## Open Questions

1. **FCC API rate limits?** — Need to test. If throttled, may need to stagger station queries.
2. **Filing PDF quality** — What % are machine-readable text vs scanned images? This affects Claude parsing cost.
3. **Scan frequency** — 4 hours is the starting point. Could go to 1 hour for high-priority markets during election season. Cost implications?
4. **Historical backfill** — Should we backfill radar from FCC data going back to Jan 2026 for watched markets? Would seed the match engine.
5. **Watch list management** — Should watch lists be per-client (multi-tenant) or global for now?
