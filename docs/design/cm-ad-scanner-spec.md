# CM Ad Scanner — Implementation Spec

**Date:** 2026-04-09
**Author:** Jarvis
**Status:** Approved by Greg

## Overview

Add a "Scan for Ads" feature to the Amplify watchlist. Batch-scans all active monitors against Critical Mention's broadcast capture to detect political ads — both those with closed captions and those hidden in CC gaps.

## Architecture

```
Watchlist Page (ops-console)
  ↓ "Scan for Ads" button
  ↓ POST /api/watchlist/scan
  ↓
Ingest Service (GCP)
  ↓ POST /scan/trigger
  ↓
scan_cm.py (new module)
  ├─ For each active monitor:
  │   ├─ For each day in flight window (intersected with today-7d..today):
  │   │   ├─ Pass 1: CC keyword search via CM API
  │   │   │   └─ Search for "approve this message" / "paid for by" on station+day
  │   │   │   └─ Any hits → download clip → transcribe → classify → insert
  │   │   ├─ Pass 2: CC gap scan
  │   │   │   └─ Search for ALL clips on station+day
  │   │   │   └─ Find minutes with empty ccText
  │   │   │   └─ Pull HLS streams for gap windows
  │   │   │   └─ Whisper transcribe → pattern match → political ad?
  │   │   │   └─ Hits → clip video → classify → insert
  │   │   └─ Update scan progress
  │   └─ Mark monitor as scanned
  └─ Complete scan job

Results → ad_clips table + creatives table → Clips page
```

## Database Changes

### New table: `cm_scans`
```sql
CREATE TABLE IF NOT EXISTS cm_scans (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status          TEXT NOT NULL DEFAULT 'queued',  -- queued, running, complete, error
    total_monitors  INTEGER DEFAULT 0,
    scanned_monitors INTEGER DEFAULT 0,
    total_days      INTEGER DEFAULT 0,
    scanned_days    INTEGER DEFAULT 0,
    clips_found     INTEGER DEFAULT 0,
    clips_matched   INTEGER DEFAULT 0,
    clips_orphaned  INTEGER DEFAULT 0,
    cm_requests_used INTEGER DEFAULT 0,
    error_details   TEXT,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
```

### New table: `cm_request_log`
```sql
CREATE TABLE IF NOT EXISTS cm_request_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id     UUID REFERENCES cm_scans(id),
    endpoint    TEXT,           -- 'search', 'stream', 'session'
    channel_id  INTEGER,
    station     TEXT,
    request_at  TIMESTAMPTZ DEFAULT NOW()
);
```

### Add columns to `stations`
```sql
ALTER TABLE stations ADD COLUMN IF NOT EXISTS cm_channel_id INTEGER;
```

### Add columns to `ad_clips`
```sql
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS cm_scan_id UUID REFERENCES cm_scans(id);
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS monitor_id UUID;
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS spender_id UUID REFERENCES spenders(id);
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS detection_method TEXT;  -- 'cc_search' or 'gap_scan'
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS video_storage_path TEXT;
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS air_date DATE;
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS air_time TEXT;
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS matched_spender_name TEXT;
```

## CM API Integration

### Auth
```
POST https://staging-partner.criticalmention.com/allmedia/session
  username=gregtusar@gmail.com
  password=c4Yz@A!DNdu5p5&@*u
→ token in response.id
```

### Pass 1: CC Keyword Search
```
POST /allmedia/search
  terms="approve this message" OR "paid for by"
  start=YYYY-MM-DD 00:00:00
  end=YYYY-MM-DD 23:59:59
  cTV=1
  tvChannels={cm_channel_id}
  limit=100
```
→ Returns clips with ccText containing political disclaimers

### Pass 2: Gap Scan
```
POST /allmedia/search
  terms=*
  start=YYYY-MM-DD {time_start}:00
  end=YYYY-MM-DD {time_end}:00
  cTV=1
  tvChannels={cm_channel_id}
  limit=500
```
→ Returns all 60-second clips for that station+window
→ Find clips where ccText is empty → those are commercial breaks
→ For consecutive empty-CC clips, construct HLS URL:
```
https://{asset_host}/stream.php?channel_id={id}&start={epoch_ms}&stop={epoch_ms}&fmt=m3u8&...
```
→ Download via ffmpeg, transcribe via Whisper API, pattern match

### Request Budget Tracking
- Track every CM API call in `cm_request_log`
- Before each scan, check: `SELECT COUNT(*) FROM cm_request_log` 
- Show remaining (1000 - used) in the UI
- Abort scan if remaining < 50 (safety margin)

## Station → CM Channel Mapping
- On first scan, call `GET /allmedia/channel?limit=2000` to get all CM channels
- Match stations.call_sign to CM channel.callSign
- Store cm_channel_id on stations table
- Cache this — it doesn't change

## Clip Processing Pipeline

For each detected ad:
1. **Download** — ffmpeg pulls HLS stream as MP4 (video) + WAV (audio)
2. **Transcribe** — OpenAI Whisper API (`whisper-1`)
3. **Detect** — Pattern match on transcript:
   - "I'm [name] and I approve this message"
   - "Paid for by [org]"
   - "Vote [yes/no]"
   - "[Name] for [office]"
   - Known PAC names
4. **Classify** — Extract: advertiser, ad_type (attack/positive/issue), candidate_mentioned
5. **Match to spender** — Try to match against:
   - The monitor's spender_name (if the ad aired in that monitor's window)
   - Transcript "paid for by" text → fuzzy match against spenders table
   - If no match → status='unmatched' (orphaned)
6. **Store** — Insert into ad_clips + optionally creatives
7. **Upload video** — Store clip MP4 in GCS bucket `amplify-raw-emails` (reuse existing bucket) under `clips/` prefix

## API Endpoints

### ops-console
- `POST /api/watchlist/scan` — Trigger a scan (calls ingest service)
- `GET /api/watchlist/scan/status` — Poll scan progress
- `GET /api/watchlist/scan/budget` — Get CM request budget remaining

### ingest service
- `POST /scan/trigger` — Start CM scan job (async, returns scan_id)
- `GET /scan/{scan_id}/status` — Scan progress

## UI Changes

### Watchlist page
- Add **"🔍 Scan for Ads"** button in the top action bar
- When clicked: POST to trigger scan, then show progress panel
- Progress panel shows:
  - Status: "Scanning WCAV (3/47 monitors, 2/5 days)..."
  - Progress bar
  - Clips found so far
  - CM requests used / remaining
- When complete: "Scan complete. Found 12 clips (8 matched, 4 orphaned). [View Clips →]"

### Clips page
- Already exists, shows ad_clips table
- New clips from CM scan appear automatically
- Add `detection_method` column (CC Search / Gap Scan)
- Add video playback if video_storage_path exists

## File Structure (new/modified)

```
services/ingest/src/
  scan_cm.py          — NEW: Core CM scanner logic
  cm_client.py        — NEW: CM API client (auth, search, stream download)
  cm_channel_map.py   — NEW: Station ↔ CM channel mapping
  server.py           — MODIFY: Add /scan/trigger and /scan/{id}/status endpoints

services/ops-console/
  app/api/watchlist/scan/route.ts        — NEW: Trigger scan
  app/api/watchlist/scan/status/route.ts — NEW: Poll progress
  app/api/watchlist/scan/budget/route.ts — NEW: CM budget
  app/ops/watchlist/page.tsx             — MODIFY: Add scan button + progress

infra/migrations/
  2026-04-09-cm-scanner.sql              — NEW: cm_scans, cm_request_log, alter stations/ad_clips
```

## Environment Variables (ingest service)
```
CM_USERNAME=gregtusar@gmail.com
CM_PASSWORD=c4Yz@A!DNdu5p5&@*u
CM_BASE_URL=https://staging-partner.criticalmention.com/allmedia
OPENAI_API_KEY=<existing>
```

## Constraints
- Trial has ~1000 CM requests remaining (soft cap, hasHardLimit=0)
- Trial expires May 31, 2026
- Each station-day costs ~2-5 CM requests (1 CC search + 1-4 gap stream pulls)
- Whisper API: $0.006/min — budget ~$50 for prototype
- Scan window: only look at last 7 days (don't burn budget on old dates)
- Max concurrent ffmpeg processes: 3 (don't overwhelm GCP instance)
