# Amplify Platform

**Automating Competitive Intelligence for Political Media**

---

## The Problem

Tracking competitive political advertising is critical work — but the current process is painfully manual. Every ad buy that comes in via email requires:

- Opening attachments (Excel, PDF — different format every time)
- Copying data field by field into spreadsheets
- Re-entering that same data into your tracking system
- Manually searching for the actual ad creative on monitoring platforms
- Downloading, clipping, re-uploading, and tagging each ad
- Composing update emails and sending them to the right distribution lists

A single ad buy takes 15-20 minutes. A single creative takes 20-30 minutes. Multiply by dozens per day across multiple districts, and you're spending the majority of your team's time on data entry — not analysis.

**Amplify eliminates the data entry.**

---

## How It Works

### 1. Spending Data Comes In Automatically

Station representatives email ad buy information to a dedicated Amplify inbox — the same way they do today. The difference: no one needs to open, read, or copy anything.

Amplify's AI reads every incoming email and its attachments — whether it's an Excel spreadsheet from CBS, a PDF confirmation from NBC, or a plain text email from a local station. It understands all of them.

Within seconds, the system extracts:

- **Who** is spending (spender/PAC name, agency)
- **How much** (total dollars, broken down by station)
- **Where** (which stations, which markets)
- **When** (flight dates, weekly breakdown)
- **Buy identifiers** (estimate numbers, spot lengths)
- **Contact info** (the station rep who sent it)

This data is immediately available in the platform — no re-typing, no spreadsheets, no copy-paste.

### 2. Ads Are Found and Catalogued Automatically

When a spender has active buys but no creative on file, Amplify flags it. As ad clips become available (via Critical Mention integration or manual upload), Amplify:

- **Transcribes** the audio/video automatically
- **Identifies** what the ad is about, who it's for, and what type it is
- **Matches** it to the correct spender and active buy
- **Catalogs** it with a searchable transcript, thumbnail, and metadata

No more scrubbing through hours of broadcast footage. No more manual clipping and re-uploading.

### 3. Updates Go Out Instantly

When a new buy or creative is processed, Amplify automatically generates update emails — competitive updates, creative updates — and sends them to the appropriate distribution lists. The same updates your team writes by hand today, delivered in seconds instead of minutes.

### 4. Edge Cases Get Flagged, Not Ignored

AI handles the straightforward cases automatically. When something needs a human eye — a new spender the system hasn't seen before, an ambiguous buy, a low-confidence extraction — it lands in a **review queue** for your team to resolve with a single click.

The goal: **your team spends their time on the 5% that actually needs judgment, not the 95% that's just data entry.**

---

## What You See

### Client Portal

Your clients get a clean, real-time view of competitive activity:

**Spending Dashboard**
- Total spending by district, market, spender, and time period
- Visual trends — who's ramping up, who's going dark
- Station-level breakdowns with weekly granularity
- Filterable, sortable, exportable

**Creative Library**
- Every ad clip catalogued with searchable transcripts
- Play directly in the browser
- Filter by spender, district, station, date, ad type
- See exactly what your opponents are saying and where

**Alerts & Reports**
- Real-time notifications when new buys or creatives are detected
- Scheduled digests (daily, weekly) delivered to your inbox
- Exportable competitive summaries for briefings

### Operations Console

Your internal team gets a command center:

**Review Queue**
- Priority-sorted list of items needing attention
- New spenders to assign to districts
- Low-confidence extractions to verify
- Buy revisions to approve
- One-click resolution for each item

**Data Management**
- Spender directory with automatic candidate/district mapping
- Station and market reference data
- Distribution list management
- Send history and audit trail

**Pipeline Monitor**
- Real-time status of email processing
- Error tracking and alerting
- Volume metrics and throughput

---

## The Data

Amplify organizes political advertising data into a clear structure:

### Who's Spending

| What We Track | Example |
|---------------|---------|
| **Spender** | One Giant Leap PAC |
| **Type** | PAC, Campaign Committee, Party, Issue Org |
| **Agency** | Sage Media Planning & Placement |
| **Party Affiliation** | Democrat, Republican, Nonpartisan |
| **Candidate Supported** | (linked to district) |
| **FEC ID** | (when available) |

### What They're Buying

| What We Track | Example |
|---------------|---------|
| **Estimate Number** | 14510 |
| **Flight Dates** | May 27 – June 2, 2025 |
| **Spot Length** | :30 seconds |
| **Total Spend** | $462,005 |
| **Status** | New, Revised, Active, Completed |

### Where It's Running

Each buy breaks down by station and market:

| Station | Market | Network | Weekly Spend | Total |
|---------|--------|---------|-------------|-------|
| WABC | New York, NY | ABC | $126,200 | $126,200 |
| WNBC | New York, NY | NBC | $112,800 | $112,800 |
| WCBS | New York, NY | CBS | $101,000 | $101,000 |
| WPIX | New York, NY | CW | $23,750 | $23,750 |
| WJLP | New York, NY | Ind | $29,700 | $29,700 |
| WCAU | Philadelphia, PA | NBC | $23,950 | $23,950 |
| KYW | Philadelphia, PA | CBS | $32,375 | $32,375 |
| WPSG | Philadelphia, PA | CW | $7,400 | $7,400 |
| WPHL | Philadelphia, PA | MyNet | $4,830 | $4,830 |

For multi-week flights, spend is further broken down week by week — matching exactly what stations report.

### What the Ads Say

| What We Track | Example |
|---------------|---------|
| **Creative Title** | "Broken Promises" |
| **Ad Type** | Attack, Contrast, Positive, Issue |
| **Transcript** | Full text of what's said in the ad |
| **Stations Aired** | WABC, WNBC, WCBS |
| **First Detected** | May 28, 2025 |
| **Video Clip** | Playable in browser with thumbnail |

### Where It All Connects

Every piece of data links together:

```
District (e.g., NJ-07)
  └── Spender (e.g., One Giant Leap PAC)
        └── Buy (Estimate #14510, May 27 – June 2)
              ├── Station: WABC — $126,200
              │     └── Creative: "Broken Promises" (100% traffic)
              ├── Station: WNBC — $112,800
              │     └── Creative: "Broken Promises" (100% traffic)
              └── Station: KYW — $32,375
                    └── Creative: "Broken Promises" (100% traffic)
```

This means you can answer questions like:
- *"How much is One Giant Leap spending in Philadelphia this week?"*
- *"What ads are running on WABC right now?"*
- *"Show me all spending in NJ-07 for the last 30 days by spender."*
- *"Which creatives have we not matched to buys yet?"*

### Additional Data Tracked

| Category | What's Tracked |
|----------|---------------|
| **Markets** | DMA name, code, rank, state |
| **Stations** | Call sign, network affiliation, owner, media type |
| **Contacts** | Station rep name, email, phone — linked to stations |
| **Notifications** | Every competitive/creative update sent, with recipients and timestamp |
| **Source Emails** | Complete audit trail of every email received and processed |

---

## How Spenders Get Matched

Most of the time, the system knows exactly who a spender is:

**Automatic (the vast majority):** A spender like "Rouse for Virginia" is unambiguous — the system recognizes it and assigns it to the correct candidate and district instantly.

**AI-Assisted:** A new PAC appears — the system searches FEC filings, cross-references the media markets being purchased, and suggests a match. If confidence is high, it auto-assigns. If not, it asks your team.

**Manual Review:** Occasionally a dark money group or brand-new organization shows up with no public record. Your team assigns it once in the review queue, and every future buy from that spender is handled automatically from that point forward.

The goal: **assign once, automate forever.**

---

## Input Formats Supported

Amplify handles every format station reps use today:

| Format | Example |
|--------|---------|
| **Excel spreadsheet** | Station-specific buy with market, station, weekly dollar columns |
| **PDF confirmation** | Network sales email with totals, flight dates, estimate number |
| **Master order list** | Multi-page political order spreadsheet (e.g., FOX's full list) |
| **Plain text email** | Station rep typing buy details directly in the email body |
| **Mixed** | Emails with multiple attachments covering different stations |

No special formatting required. Station reps continue sending exactly what they send today.

---

## Infrastructure & Handoff

Amplify runs entirely on Google Cloud Platform in a dedicated, self-contained project. There are no external dependencies on proprietary systems or personal infrastructure.

**What this means for you:**
- The entire platform — code, data, infrastructure — can be transferred to your own Google Cloud account in a single operation
- Full infrastructure-as-code: the complete system can be rebuilt from scratch in minutes
- No vendor lock-in on any component
- Your data stays in your environment

---

## What's Built Today

| Component | Status |
|-----------|--------|
| Cloud infrastructure (GCP project, databases, storage) | ✅ Live |
| Email ingestion pipeline (receive → extract → store) | ✅ Live |
| AI extraction engine (reads Excel, PDF, text emails) | ✅ Live |
| Ad clip transcription (audio/video → text) | ✅ Built |
| Data model (16 tables covering all entities) | ✅ Live |
| Infrastructure-as-code (Terraform) | ✅ Complete |
| Ops Console (review queue, data management) | 📋 Next |
| Client Portal (dashboards, creative library) | 📋 Next |
| Auto-notifications (competitive/creative updates) | 📋 Next |
| Critical Mention API integration | 📋 Pending CM |

---

## Next Steps

1. **Validate the data model** against your current workflows — are we capturing everything?
2. **Test extraction accuracy** by forwarding real station emails to the Amplify inbox
3. **Prioritize the UI** — Ops Console first (your team needs it) or Client Portal first (clients need it)?
4. **Define distribution lists** — which districts, which recipients?
5. **Critical Mention** — timeline on their API availability?
