# Watchlist Refactor — Kill the Monitors Table

**Date:** 2026-04-09
**Author:** Jarvis
**Status:** Approved by Greg

## Problem

The `monitors` table is a prematerialized cache that goes stale. New FCC filings arrive with parsed line items but monitors don't get created because `build_monitors` isn't wired up in the scanner. This causes:
- Active filings not showing in the watchlist
- Scanner missing valid scan targets  
- Dedup bugs collapsing different dayparts
- Stale flight dates from old filings

## Solution

Delete the monitors indirection. The watchlist and CM scanner query **source data directly**:
- `radar_items` (FCC filings with parsed_data JSON containing line_items)
- `buy_lines` + `buy_line_dayparts` (email buys)

## What Changes

### Watchlist API (`GET /api/monitors` → `GET /api/watchlist/monitors`)

Replace the monitors table query with a UNION of:

**Source 1: radar_items** (FCC filings)
```sql
SELECT 
    ri.id,
    ri.station_call_sign,
    ri.spender_name,
    ri.flight_start,
    ri.flight_end,
    ri.market_name,
    ri.parsed_data,  -- contains line_items with daypart, time, days
    'fcc' as source
FROM radar_items ri
WHERE ri.flight_end >= CURRENT_DATE - 7
  AND ri.flight_start <= CURRENT_DATE
  AND ri.parsed_data IS NOT NULL
  AND ri.parsed_data::jsonb -> 'line_items' IS NOT NULL
  AND jsonb_array_length(ri.parsed_data::jsonb -> 'line_items') > 0
  -- market filter applied here
```

**Source 2: buy_lines** (email buys)
```sql
SELECT
    bl.id,
    bl.station_call_sign,
    b.spender_name,
    bl.flight_start,
    bl.flight_end,
    bl.market_name,
    NULL as parsed_data,
    'buy' as source
FROM buy_lines bl
JOIN buys b ON bl.buy_id = b.id
WHERE bl.flight_end >= CURRENT_DATE - 7
  AND bl.flight_start <= CURRENT_DATE
  -- market filter applied here
```

For display, unpack `parsed_data -> line_items` into rows (one per daypart) for radar_items. For buy_lines, join to `buy_line_dayparts` for the same info.

### CM Scanner (`scan_cm.py`)

Replace the monitors query with the same live query. For each result:
- If it has `parsed_data.line_items` → use daypart, time_start, time_end, days
- If it has `buy_line_dayparts` → use those
- If neither → scan full day (00:00-23:59)

### What Gets Deleted

- `monitors` table — DROP (after migration)
- `build_monitors.py` — DELETE
- `batch_parse_concurrent.py` references to build_monitors — REMOVE
- `scan_radar.py` import of build_monitors — REMOVE
- `GET /api/monitors` route — REPLACE with new query

### What Gets Modified

| File | Change |
|------|--------|
| `services/ingest/src/scan_cm.py` | Query radar_items + buy_lines instead of monitors |
| `services/ops-console/app/api/monitors/route.ts` | Rewrite to query radar_items + buy_lines |
| `services/ops-console/app/ops/watchlist/page.tsx` | Update column mapping (minor) |

### Watchlist UI Columns (unchanged visually)

| Column | Source (radar_items) | Source (buy_lines) |
|--------|---------------------|-------------------|
| Station | station_call_sign | station_call_sign |
| Market | market_name | market_name |
| Spender | spender_name | buys.spender_name |
| Daypart | parsed_data.line_items[].daypart | buy_line_dayparts.daypart |
| Time Window | parsed_data.line_items[].time | buy_line_dayparts.time_start/end |
| Days | parsed_data.line_items[].days | buy_line_dayparts.days |
| Flight | flight_start – flight_end | flight_start – flight_end |
| Source | 🏛️ FCC | 📧 Email |

### New: Source indicator
Add a column showing where the data came from (FCC filing vs email buy). Helps the user understand data provenance.
