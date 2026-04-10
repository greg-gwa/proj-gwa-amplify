# PRD: Critical Mention Automation — "Ad Spotter"

## Problem

Campaigns and media buyers use Critical Mention to monitor when their (and opponents') TV/radio ads actually air. Today this requires an army of humans who:

1. Set up keyword alerts in Critical Mention
2. Receive alert emails
3. Open Critical Mention, review each segment
4. Manually create/trim clips
5. Download MP4s
6. Categorize (ad vs earned media vs news mention)
7. Log into spreadsheets / report to client

**This is 100% automatable.** Critical Mention's API exposes keyword search with full transcripts and streamable media for every 60-second broadcast segment across 2,000+ channels.

---

## Key Insight: The FCC Radar Is the Scheduling Brain

The hardest question in broadcast monitoring is: **"When should I watch which channels for which ads?"**

Amplify already answers this. The existing pipeline produces:

| Data Source | What It Tells You |
|---|---|
| **FCC Filings (radar_items)** | WHO is buying ads, on WHICH station, for WHAT flight dates, HOW MUCH they're spending |
| **Buy Data (buys + buy_lines)** | Agency-submitted buy orders: spender, stations, flight dates, dayparts, dollar amounts, spot counts |
| **Spender Aliases** | Normalized name mappings so "SLF PAC", "Senate Leadership Fund", "ISS/SLF PAC" all resolve to one entity |

**Example:** FCC radar detects "SLF PAC" filed a political buy on WJLA (DC market) for flight 3/18–4/24, $450K.

→ Ad Spotter knows to search Critical Mention for `"SLF PAC" OR "Senate Leadership Fund"` on WJLA's channel ID, between 3/18 and 4/24.

→ No human decides what to monitor. The data decides.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Amplify Database                       │
│  radar_items (FCC filings)  ←→  buys (agency reports)    │
│  spenders + spender_aliases                              │
│  ad_airings (NEW)                                        │
└──────────────┬──────────────────────────────┬────────────┘
               │                              │
               ▼                              ▼
    ┌──────────────────┐          ┌────────────────────────┐
    │  Watch Scheduler  │          │   Critical Mention API  │
    │  (cron, hourly)   │────────→│   POST /search          │
    │                   │          │   GET /clip             │
    └──────────────────┘          └────────────┬───────────┘
                                               │
                                               ▼
                                    ┌──────────────────────┐
                                    │   AI Classifier       │
                                    │   (Claude/GPT)        │
                                    │                       │
                                    │   Input: ccText       │
                                    │   Output:             │
                                    │   - ad / earned / news│
                                    │   - candidate         │
                                    │   - sentiment         │
                                    │   - issue/topic       │
                                    └──────────┬───────────┘
                                               │
                                               ▼
                                    ┌──────────────────────┐
                                    │   ad_airings table    │
                                    │   + GCS clip storage  │
                                    │   + Dashboard / API   │
                                    └──────────────────────┘
```

---

## Watch Scheduler Logic

The scheduler runs hourly and builds a **watch list** from active data:

### Step 1: Build Active Watches

```sql
-- All spenders with active flights (flight happening now or in last 24h)
SELECT DISTINCT
    s.id AS spender_id,
    s.name AS spender_name,
    ri.station_call_sign,
    ri.flight_start,
    ri.flight_end,
    ri.total_dollars
FROM radar_items ri
JOIN spenders s ON ri.matched_spender_id = s.id  -- or via fuzzy match
WHERE ri.flight_start <= CURRENT_DATE + INTERVAL '1 day'
  AND ri.flight_end >= CURRENT_DATE - INTERVAL '1 day'
  AND ri.status IN ('matched_to_buy', 'likely_match', 'new')
```

Plus enrichment from buys:
```sql
-- Add buy-level detail: dayparts, spot counts
SELECT b.spender_name, bl.station_call_sign, bl.daypart, bl.time_start, bl.time_end
FROM buys b
JOIN buy_lines bl ON bl.buy_id = b.id
WHERE b.flight_start <= CURRENT_DATE + INTERVAL '1 day'
  AND b.flight_end >= CURRENT_DATE - INTERVAL '1 day'
```

### Step 2: Map Stations → CM Channel IDs

One-time mapping table: `station_cm_channels`

```sql
CREATE TABLE station_cm_channels (
    station_call_sign TEXT PRIMARY KEY,  -- e.g., 'WJLA'
    cm_channel_id INTEGER NOT NULL,      -- Critical Mention channel ID
    market_id INTEGER,
    market_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Populated by calling `GET /channel` and `GET /channel/channelMarkets` from CM API, then matching call signs.

### Step 3: Search Critical Mention

For each active watch:

```python
POST /search
{
    "start": "2026-04-07 00:00:00",       # last 24h (or since last scan)
    "end": "2026-04-08 00:00:00",
    "booleanQuery": '"SLF PAC" OR "Senate Leadership Fund"',
    "cTV": 1,
    "tvChannels": "7068,7069",            # mapped CM channel IDs
    "tvGenres": "Politics,News",
    "limit": 500,
    "sortOrder": "desc"
}
```

**Keyword construction from spender + aliases:**
```python
# Build boolean query from spender name + all aliases
aliases = ["SLF PAC", "Senate Leadership Fund", "Senate Leadership"]
query = " OR ".join(f'"{a}"' for a in aliases)
# → "SLF PAC" OR "Senate Leadership Fund" OR "Senate Leadership"
```

### Step 4: Classify Each Segment

For each search result, feed `ccText` to Claude:

```
Classify this TV broadcast segment transcript:

Station: {callSign} ({marketName})
Program: {title}
Time: {time}
Transcript: {ccText}

Is this:
1. POLITICAL_AD — A paid political advertisement
2. EARNED_MEDIA — News coverage mentioning the candidate/PAC
3. NEWS_MENTION — Brief mention in broader coverage
4. NOT_RELEVANT — False positive / not political

If POLITICAL_AD:
- Candidate/PAC name
- Supporting or opposing?
- Issue/topic (economy, immigration, healthcare, etc.)
- Tone (positive, negative, contrast)

Respond as JSON.
```

### Step 5: Store & Clip

```sql
CREATE TABLE ad_airings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spender_id UUID REFERENCES spenders(id),
    radar_item_id UUID REFERENCES radar_items(id),  -- link to FCC filing
    buy_id UUID REFERENCES buys(id),                 -- link to buy order
    
    -- From Critical Mention
    cm_uuid TEXT UNIQUE NOT NULL,          -- CM segment UUID
    cm_channel_id INTEGER,
    station_call_sign TEXT,
    market_name TEXT,
    market_rank INTEGER,
    program_title TEXT,
    
    -- Timing
    aired_at TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER DEFAULT 60,
    
    -- Content
    transcript TEXT,                       -- ccText
    media_url TEXT,                        -- HLS stream URL
    clip_gcs_path TEXT,                    -- archived MP4 in GCS
    thumbnail_url TEXT,
    
    -- Classification
    segment_type TEXT NOT NULL,            -- POLITICAL_AD, EARNED_MEDIA, NEWS_MENTION
    candidate_name TEXT,
    supporting_or_opposing TEXT,           -- supporting, opposing, neutral
    issue_topic TEXT,
    tone TEXT,
    classification_confidence FLOAT,
    
    -- Metrics (from CM)
    ad_value_national FLOAT,              -- SQAD ad equivalency
    ad_value_local FLOAT,
    audience_national INTEGER,            -- Nielsen households
    audience_local INTEGER,
    
    -- Metadata
    detected_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ad_airings_spender ON ad_airings(spender_id);
CREATE INDEX idx_ad_airings_aired ON ad_airings(aired_at);
CREATE INDEX idx_ad_airings_type ON ad_airings(segment_type);
CREATE INDEX idx_ad_airings_market ON ad_airings(market_name);
```

---

## What This Unlocks

### 1. Ad Verification (The Army Replacement)
- "Did our ad actually air on WJLA at 6pm like we paid for?" → Yes, here's the clip
- "How many times did our opponent's ad air this week?" → 47 times across 12 stations
- **Fully automated, zero humans**

### 2. Earned Media Tracking
- Same search catches news mentions — "Senator X was discussed on CNN at 2:14pm"
- Sentiment analysis on earned vs paid
- Share of voice: paid airings vs earned mentions

### 3. Flight Verification vs Buy Order
- Buy says 50 spots on WJLA, 3/18–4/24
- Ad Spotter detected 43 spots actually aired
- **"You paid for 50, got 43. Station owes you a makegood."**
- This is *enormous* value — stations frequently under-deliver

### 4. Competitive Intelligence Dashboard
- Real-time: "SLF PAC just started airing in the Des Moines market"
- Trend: "Opponent's ad frequency increased 3x this week in swing markets"
- Geographic: heatmap of ad saturation by DMA

### 5. The Closed Loop (Messaging Brain Integration)
- Greywolf detects opponent ad → analyzes message → auto-drafts counter-message
- Tests counter-message via email/text A/B → measures response
- Adjusts own ad buy strategy based on opponent activity

---

## Implementation Phases

### Phase 1: Plumbing (1-2 days)
- [ ] `POST /session` — authenticate, store token (refresh hourly)
- [ ] `GET /channel` + `GET /channel/channelMarkets` — build `station_cm_channels` mapping table
- [ ] `POST /search` — basic keyword search, verify results look right
- [ ] Store raw search results in staging table

### Phase 2: Watch Scheduler (1 day)
- [ ] Build watch list from active `radar_items` + `buys` with current flights
- [ ] Map FCC station call signs → CM channel IDs
- [ ] Build boolean queries from spender names + aliases
- [ ] Hourly cron: search CM for all active watches since last scan

### Phase 3: AI Classification (1 day)
- [ ] Claude classifier for `ccText` → ad/earned/news/irrelevant
- [ ] `ad_airings` table + insertion pipeline
- [ ] Clip archival: download HLS → MP4 → GCS

### Phase 4: Dashboard (1-2 days)
- [ ] Ad Airings page in ops console
- [ ] Flight verification: expected spots vs detected spots
- [ ] Competitive view: all detected airings by race/market

### Phase 5: Alerting + Integration
- [ ] Real-time alerts: "New opponent ad detected in [market]"
- [ ] Makegood detection: spots paid vs spots aired
- [ ] Export: CSV/PDF reports for campaign staff

---

## Requirements

- [ ] **Critical Mention API credentials** — partner-level access with API token
- [ ] **CM channel ID mapping** — one-time call to `GET /channel` to map FCC call signs → CM IDs
- [ ] **Rate limits** — need to confirm with CM; search likely has per-minute/per-day caps
- [ ] **Cost** — API access is separate from standard CM subscription; need pricing

---

## Open Questions

1. **Do they have API access already, or just the UI license?** API is a separate add-on.
2. **Rate limits on `/search`?** If 500 results/call and we're watching 100 spender/station combos hourly, that's manageable. But need to confirm.
3. **Media URL expiration?** The HLS stream URLs have HMAC signatures with `exp=` timestamps. Need to download clips promptly or re-request.
4. **60-second segments** — political ads are typically :30 or :15. A 60-sec segment might contain the ad + surrounding content. Do we need to trim, or is the full segment fine?
5. **Historical backfill** — how far back can we search? Could verify past flights retroactively.
