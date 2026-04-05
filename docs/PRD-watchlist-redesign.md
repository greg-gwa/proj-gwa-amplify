# PRD: Watchlist Redesign — Region-Based Monitoring View

## Summary

Consolidate the current **Watchlist** (scanner config) and **Monitors** (per-contract windows) into a single **Watchlist** page. The new Watchlist is a region-based monitoring dashboard: pick your markets at the top, see all active monitors for those markets below.

Move the scanner log (scan history) to a new **Scanner** tab.

## Current State

| Tab | Purpose |
|-----|---------|
| Watchlist | Scanner config: pick watched markets, view scan interval/lookback, recent scan log |
| Monitors | Flat table of all active monitor windows from parsed contracts |

**Problems:**
- Watchlist "watched markets" config is vestigial — scanner already scans ALL stations
- Monitors page has no region filtering — shows all 7,699 active monitors flat
- No way to answer "what's airing in my region right now?"

## New Design

### Sidebar Navigation Change

```
Before:                    After:
◎ Radar                    ◎ Radar
◎ Watchlist                👁 Watchlist (redesigned)
👁 Monitors                📡 Scanner (new, was scan log)
```

### Watchlist (Redesigned)

**Top: Region Picker**
- Multi-select DMA market chips (same search-and-add UX as current watchlist)
- Persisted in `radar_config` as `watched_market_ids`
- "All Markets" toggle to see everything
- Stat cards: X active monitors, Y stations, Z spenders, $total dollars

**Below: Monitors Table (filtered by selected regions)**
- Same columns as current Monitors page: Station, Market, Spender, Daypart, Time, Flight Dates, Status, Matches
- Filtered to only show monitors in selected markets
- If no markets selected, show prompt: "Select markets above to see active monitors"
- Sortable, searchable

**Key behavior:** Selecting a region answers "if I were monitoring [market], here's every ad window I'd be watching for."

### Scanner (New Tab)

- Recent scan log (moved from old Watchlist)
- Scan interval display
- Lookback window display
- Manual "Scan Now" button
- Simple, operational — the "plumbing" view

### API Changes

**`GET /api/monitors`** — add `market_ids` query param (comma-separated UUIDs):
```
GET /api/monitors?market_ids=uuid1,uuid2&active=true
```

**`GET /api/watchlist`** — returns `watched_market_ids` (for region picker state)

**`POST /api/watchlist`** — add/remove market from watched list

### DB Changes

None — `radar_config.watch_config` already stores `market_ids`. Just rename the semantic: these are "display filter" markets, not "scan scope" markets.

## Out of Scope

- Scanner scope changes (already scans all stations)
- Monitor creation logic (already driven by batch_parse → build_monitors)
- Alerts/notifications per region (future)
