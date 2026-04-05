# Amplify — System Workflow (Working Draft)

**Date:** April 3, 2026
**Source:** Greg Tusar (architecture session)

---

## The Lifecycle of an Ad

```
┌─────────────────────────────────────────────────────────────────┐
│  1. SCOUT                                                       │
│     FCC Public File scraper detects new political filing        │
│     → Creates "Radar" item (spender, station, dates, dollars)  │
│     → ~24h early warning before ad airs                        │
│                                                                 │
│  2. BUY INGESTION                                              │
│     Station rep emails buy details (Excel/PDF/text)            │
│     → AI parses: spender, estimate #, stations, dates, $$$     │
│     → If parsed correctly → Active Buy                         │
│     → If missing/wrong data → Review Queue (human fixes)       │
│     → Auto-link to matching Radar item if one exists           │
│                                                                 │
│  3. ACTIVE MONITORING                                          │
│     For each Active Buy, system knows:                         │
│       • Which stations to watch                                │
│       • What date range (flight start → end)                   │
│       • What time windows (if available)                       │
│     This creates a WATCH LIST — stations × date ranges         │
│     → Drives Critical Mention monitoring queries               │
│                                                                 │
│  4. CREATIVE CAPTURE                                           │
│     Critical Mention surfaces political ads on watched stations│
│     → Whisper transcribes the clip                             │
│     → AI extracts: "Paid for by ___" → matches to spender     │
│     → AI extracts: sentiment, keywords, ad type, themes       │
│     → If FIRST INSTANCE of this ad:                            │
│         • Download & store clip                                │
│         • Generate thumbnail                                   │
│         • Create Creative record                               │
│         • Send Creative Update to clients                      │
│     → If REPEAT airing:                                        │
│         • Increment airing count                               │
│         • Log station, date, time                              │
│         • Update aggregate stats                               │
│                                                                 │
│  5. REPORTING & ANALYSIS                                       │
│     Client portal shows:                                       │
│       • Active buys with spend by station/market               │
│       • Creative library (clips + transcripts + thumbnails)    │
│       • Aggregate stats per creative (airings, stations, reach)│
│       • Competitive updates (email notifications)              │
│                                                                 │
│  6. INTELLIGENCE (Phase 2)                                     │
│     Chatbot / analysis layer:                                  │
│       • "What's [spender] running in Philadelphia?"            │
│       • "Compare attack ad volume across NJ districts"         │
│       • Cross-channel, cross-race analysis                     │
│       • Sentiment trends over time                             │
│       • Keyword/theme clustering                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## The Watch List

At any given time, the system maintains a list of **stations being actively monitored** based on:

- **Active buys** — flight dates that include today (or upcoming)
- **Station + market** from buy lines
- **Time windows** — if buy specifies dayparts (morning, prime, etc.)

This is the bridge between buy ingestion and creative capture. Without the watch list, we'd be searching all of Critical Mention blindly.

```
WATCH LIST (derived from active buys)
┌──────────┬──────────────────┬─────────────┬──────────────────────┐
│ Station  │ Market           │ Flight      │ Spender(s)           │
├──────────┼──────────────────┼─────────────┼──────────────────────┤
│ WABC     │ New York, NY     │ 5/27 – 6/2  │ One Giant Leap PAC  │
│ WNBC     │ New York, NY     │ 5/27 – 6/2  │ One Giant Leap PAC  │
│ WCBS     │ New York, NY     │ 5/27 – 6/2  │ One Giant Leap PAC  │
│ WSET     │ Roanoke, VA      │ 5/25 – 6/8  │ VA Fair Elections   │
│ KYW      │ Philadelphia, PA │ 5/27 – 6/2  │ One Giant Leap PAC  │
└──────────┴──────────────────┴─────────────┴──────────────────────┘
```

---

## Creative Matching Logic

When a political ad is captured from Critical Mention:

1. **Transcribe** (Whisper) → full text
2. **Extract "Paid for by ___"** → maps to spender
3. **Match to active buy** by: spender + station + overlapping dates
4. **Dedup creative**: Is this the same ad we've already captured?
   - Compare transcript similarity (fuzzy match)
   - Same spender + similar transcript = same creative
   - Different transcript = new creative
5. **First instance** → full capture (clip, thumbnail, metadata)
6. **Repeat** → increment counter, log airing details

---

## Aggregate Stats (per Creative)

| Metric | Description |
|--------|-------------|
| Total airings | Count of times this ad was detected |
| Stations aired on | List + count |
| Markets reached | Unique DMAs |
| Date range | First detected → last detected |
| Estimated impressions | (Phase 2 — requires ratings data) |
| Sentiment | Attack / contrast / positive / issue |
| Key themes | AI-extracted topics and keywords |
| Transcript | Full searchable text |

---

## Open Questions

### Critical Mention Integration
**How does monitoring get triggered?**
- Option A: CM has an API we poll with station + date range queries
- Option B: CM sends alerts/webhooks when political ads detected
- Option C: CM provides a feed we filter against our watch list
- Option D: Manual for now — ops team searches CM using watch list as guide

**Status:** CM working on API access + universal transcription. Need to resolve which integration model they'll support.

### FCC Scraper
- FCC Public File has a documented API (free, public)
- Need to determine: poll frequency, which stations to monitor, parsing format
- Filing format varies by station (some organized, some dump everything)
- Contracts vs invoices: contracts = ordered, invoices = what actually aired

### Airing Tracking
- Do we count airings ourselves (via CM clip detection)?
- Or do we get airing counts from a data source (CM, FCC invoices)?
- Station invoices show actual aired spots — but come after the fact
- CM real-time detection gives us approximate count as it happens

---

## Data Model Implications

### New/Modified Tables Needed

**`radar_items`** — FCC early warning
- fcc_filing_id, station, spender_name, dates, dollars
- status: new / matched_to_buy / expired / dismissed
- matched_buy_id (nullable — linked when email buy arrives)

**`watch_list`** (materialized view or derived)
- station, market, flight_start, flight_end, spender_id, buy_id
- active flag (within current date range)

**`creative_airings`** — individual airing log
- creative_id, station, market, aired_at, source (CM clip id)
- Enables: airing count, station distribution, time-of-day analysis

**`creatives`** (enhanced)
- Add: thumbnail_url, first_detected_at, total_airings
- Add: sentiment, keywords[], themes[]
- Add: transcript_hash (for dedup)
