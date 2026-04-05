# Amplify Ops Console — Product Requirements Document

**Version:** 0.1 (Draft)
**Date:** April 3, 2026
**Author:** Jarvis / Greg Tusar

---

## Executive Summary

The Ops Console is Amplify's internal admin interface — the replacement for "Little AL." It gives the TMG operations team visibility into the automated pipeline and control over the edge cases AI can't handle alone. 

This is **Phase 1** of the Amplify UI. The client-facing portal ("Big AL" replacement) comes later.

---

## Goals

1. **See what's coming in:** Real-time view of emails received and their processing status
2. **See what was extracted:** Parsed ad buys with structured data, confidence scores, and source material
3. **Handle edge cases:** Review queue for low-confidence extractions, unknown spenders, and revisions
4. **Prove the pipeline:** Demonstrate end-to-end value with real data before building the client portal

---

## Architecture

### Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| **Framework** | Next.js 14 (App Router) | React + SSR + API routes in one package |
| **Styling** | Tailwind CSS + shadcn/ui | Fast to build, clean look, accessible components |
| **Data** | BigQuery (read) via API routes | Same data store as the ingest pipeline |
| **Deployment** | Cloud Run | Same GCP project, consistent infra |
| **Auth** | Simple API key or Google IAM | Internal tool — no public access needed |

### Service Layout

```
proj-amplify/
├── services/
│   ├── ingest/          # (existing) Email → Claude → BigQuery
│   └── ops-console/     # (NEW) Next.js admin interface
│       ├── src/
│       │   ├── app/
│       │   │   ├── layout.tsx
│       │   │   ├── page.tsx              # Dashboard
│       │   │   ├── emails/
│       │   │   │   └── page.tsx          # Email queue
│       │   │   ├── buys/
│       │   │   │   ├── page.tsx          # Buy list
│       │   │   │   └── [id]/page.tsx     # Buy detail
│       │   │   ├── clips/
│       │   │   │   └── page.tsx          # Clip transcription queue
│       │   │   ├── spenders/
│       │   │   │   └── page.tsx          # Spender directory
│       │   │   ├── review/
│       │   │   │   └── page.tsx          # Review queue
│       │   │   └── api/
│       │   │       ├── emails/route.ts   # BQ query: raw_emails
│       │   │       ├── buys/route.ts     # BQ query: buys + buy_lines
│       │   │       ├── clips/route.ts    # BQ query: ad_clips
│       │   │       ├── spenders/route.ts # BQ query: spenders
│       │   │       └── stats/route.ts    # BQ query: dashboard stats
│       │   └── lib/
│       │       └── bigquery.ts           # Shared BQ client
│       ├── Dockerfile
│       ├── package.json
│       └── tailwind.config.ts
└── ...
```

---

## Screens

### 1. Dashboard (`/`)

The landing page. At-a-glance pipeline health.

**Stat Cards (top row):**
- Emails received (today / this week)
- Buys extracted (today / this week)
- Clips transcribed (today / this week)
- Items in review queue
- Total spend tracked (this week)

**Recent Activity Feed (main area):**
Reverse-chronological list of events:
- `📧 Email received from nick.brown@disney.com — "Political Orders" — 3 buys extracted`
- `🎬 Clip transcribed: WGME Portland (10:00) — 2 political ads identified`
- `⚠️ New spender: "Virginians for Fair Elections" — needs district assignment`
- `✅ Buy #14510 auto-matched to One Giant Leap PAC → NJ-07`

Each event is clickable → navigates to the relevant detail page.

**Pipeline Status (sidebar or bottom):**
- Ingest service: healthy/unhealthy (last webhook received timestamp)
- Emails pending processing: count
- Error count (last 24h)

---

### 2. Email Queue (`/emails`)

Every email received by the system.

**Table Columns:**
| Column | Description |
|--------|-------------|
| Received | Timestamp |
| From | Sender email |
| Subject | Email subject line |
| Attachments | Count + file types (xlsx, pdf, etc.) |
| Status | `processed` / `pending` / `error` |
| Buys Extracted | Count (0 = no political content detected) |
| Confidence | Avg extraction confidence |
| Actions | View detail, Reprocess |

**Filters:**
- Status: All / Processed / Pending / Error
- Date range
- Search (subject, sender)

**Email Detail View (expandable or modal):**
- Original email body (text)
- Attachment list (with links to view/download from GCS)
- Extraction results: JSON payload from Claude
- Buys created from this email (linked)
- "Reprocess" button (re-runs Claude extraction)

---

### 3. Buy List (`/buys`)

All extracted ad buys.

**Table Columns:**
| Column | Description |
|--------|-------------|
| Date | Extraction date |
| Estimate # | Buy estimate number |
| Spender | PAC/campaign name |
| Agency | Media buying agency |
| Flight | Start – end dates |
| Stations | Count + list |
| Total $ | Sum of all station line items |
| Confidence | Extraction confidence score |
| Status | `new` / `matched` / `review` / `archived` |

**Filters:**
- Spender (dropdown)
- Date range
- Status
- Market
- Min/max dollar amount

**Buy Detail View (`/buys/[id]`):**
- Header: Spender, estimate #, agency, flight dates, total dollars, confidence
- **Station Breakdown Table:**
  | Station | Market | Network | Total $ | Weekly Breakdown |
  |---------|--------|---------|---------|-----------------|
  | WABC | New York | ABC | $126,200 | Week 1: $126,200 |
  
- Source email (linked)
- Raw extraction JSON (collapsible)
- Matched creatives (linked, if any)
- Edit capability: correct any extracted field
- "Approve" / "Flag for Review" buttons

---

### 4. Clip Queue (`/clips`)

Transcribed ad clips from Critical Mention or manual upload.

**Table Columns:**
| Column | Description |
|--------|-------------|
| Date | Transcription date |
| Source | Station / market |
| Duration | Clip length |
| Ad Type | attack / contrast / positive / issue / unknown |
| Advertiser | Extracted spender name |
| Matched Buy | Linked buy (if matched) |
| Confidence | Extraction confidence |
| Status | `matched` / `unmatched` / `not_political` |

**Clip Detail View:**
- Video player (if clip URL available)
- Full transcript
- AI extraction results (ad type, advertiser, candidate mentioned)
- "Match to Buy" action (dropdown of active buys for this spender)
- "Mark as Not Political" action

**Upload Section:**
- Drag-and-drop or URL input for new clips
- Triggers Whisper transcription → Claude extraction → store

---

### 5. Spender Directory (`/spenders`)

Master list of all known spenders.

**Table Columns:**
| Column | Description |
|--------|-------------|
| Name | Spender/PAC name |
| Type | PAC / Campaign / Party / Issue Org |
| Agency | Media agency |
| Party | D / R / Other |
| District | Assigned district(s) |
| FEC ID | If known |
| Total Buys | Count |
| Total Spend | Sum of all buys |
| Status | `verified` / `unassigned` / `duplicate` |

**Spender Detail:**
- Edit all fields
- Merge with another spender (dedup)
- All buys for this spender (table)
- All creatives for this spender

**Add Spender:**
- Manual creation form
- FEC lookup (enter committee name → search FEC API → auto-fill)

---

### 6. Review Queue (`/review`)

Priority-sorted list of items needing human attention. This is the core workflow screen for the ops team.

**Queue Item Types:**

| Priority | Type | Description | Actions |
|----------|------|-------------|---------|
| 🔴 High | **New Spender** | Unrecognized spender, needs district assignment | Assign District, Create Spender |
| 🔴 High | **Low Confidence** | AI extraction confidence < 0.7 | Verify & Approve, Edit & Approve |
| 🟡 Medium | **Revision** | Buy marked as "REVISED" — may supersede existing | Link to Original, Approve |
| 🟡 Medium | **Unmatched Clip** | Transcribed clip not matched to any buy | Match to Buy, Mark Not Political |
| 🔵 Low | **Missing Creative** | Active buy with no matched creative | Dismiss (will resolve when clip arrives) |

**Each queue item shows:**
- Item type badge (color-coded)
- Summary (spender name, estimate #, dollars, station list)
- AI suggestion (if any) with confidence
- Source email subject + timestamp
- One-click action buttons (Approve / Edit / Assign / Skip)

**Queue Behavior:**
- Items auto-resolve when the underlying issue is fixed (e.g., spender gets assigned)
- "Skip" moves item to bottom, not dismissed
- Resolved items move to a "Completed" tab (audit trail)

---

## API Routes

All API routes query BigQuery and return JSON. The ops console is read-heavy with occasional writes.

### Read Endpoints

```
GET /api/stats
  → { emails_today, buys_today, clips_today, review_count, spend_this_week }

GET /api/emails?status=pending&limit=50&offset=0
  → { emails: [...], total: N }

GET /api/emails/[id]
  → { email: {...}, buys: [...], raw_extraction: {...} }

GET /api/buys?spender=X&status=new&limit=50
  → { buys: [...], total: N }

GET /api/buys/[id]
  → { buy: {...}, lines: [...], source_email: {...}, creatives: [...] }

GET /api/clips?status=unmatched&limit=50
  → { clips: [...], total: N }

GET /api/spenders?status=unassigned&limit=50
  → { spenders: [...], total: N }

GET /api/review?limit=50
  → { items: [...], total: N }  (priority sorted)
```

### Write Endpoints

```
POST /api/buys/[id]/approve
  → Mark buy as verified

PATCH /api/buys/[id]
  → Update buy fields (spender, dates, dollars, etc.)

POST /api/spenders
  → Create new spender

PATCH /api/spenders/[id]
  → Update spender (assign district, merge, etc.)

POST /api/clips/[id]/match
  → { buy_line_id: "..." } — match clip to a buy line

POST /api/clips/upload
  → { url: "..." } or multipart file — trigger transcription pipeline

POST /api/emails/[id]/reprocess
  → Re-run Claude extraction on this email
```

---

## Data Layer Notes

### BigQuery Tables Used

The ops console reads from these existing tables:

| Table | Used For |
|-------|----------|
| `raw_emails` | Email queue |
| `buys` | Buy list, review queue |
| `buy_lines` | Buy detail (station breakdown) |
| `buy_line_weeks` | Weekly breakdown within buy detail |
| `spenders` | Spender directory, review queue |
| `ad_clips` | Clip queue |
| `contacts` | Station rep info |

### Schema Gap

The Terraform in `infra/bigquery.tf` currently only defines the legacy tables (`raw_emails`, `venues`, `shows`, `prices`). The political ad tables (`spenders`, `buys`, `buy_lines`, `buy_line_weeks`, `contacts`, `ad_clips`) were created directly in BQ but need to be added to Terraform for reproducibility.

**Action item:** Update `infra/bigquery.tf` to include all political ad tables before the ops console goes live. This ensures `terraform apply` can rebuild the full schema.

### Tables Not Yet Created

These tables from the PRD are referenced but not yet in BQ:

| Table | Needed For |
|-------|-----------|
| `markets` | Market reference data |
| `stations` | Station reference data |
| `districts` | District reference data |
| `creatives` | Matched ad creatives |
| `creative_assignments` | Creative ↔ buy_line mapping |
| `notifications` | Outbound notification log |

**For Phase 1:** The ops console can work without these — buys already store `market_name` and `station_call_sign` inline. Reference tables are a Phase 2 normalization.

---

## Whisper Integration (Clip Pipeline)

Proven working as of April 3, 2026. Pipeline:

```
MP4 clip → ffmpeg (extract audio → MP3) → OpenAI Whisper API → transcript
  → Claude (identify political ads, extract metadata) → BigQuery (ad_clips)
```

**Performance (tested on 5 Critical Mention clips):**

| Clip | Duration | Transcript Chars | Cost |
|------|----------|-----------------|------|
| KETV Omaha | 6:57 | 6,800 | ~$0.04 |
| WSET Roanoke | 6:00 | 5,466 | ~$0.04 |
| WAGA Atlanta | 6:00 | 5,654 | ~$0.04 |
| WSLS Roanoke | 10:00 | 9,716 | ~$0.06 |
| WGME Portland | 10:00 | 9,835 | ~$0.06 |

Total: ~39 minutes transcribed for ~$0.24. Quality: excellent — clearly captures both news segments and political ad content.

**Key finding:** Critical Mention clips contain full broadcast segments (news + ads mixed together). The Claude extraction step needs to **segment** the transcript to isolate political ads from surrounding content. The existing `ingest_clip.py` handles this — it identifies whether the content is a political ad and extracts structured metadata.

**Ops Console integration:**
- `/clips` page shows transcription queue with status
- Upload widget triggers the full pipeline (ffmpeg → Whisper → Claude → BQ)
- Manual upload supports drag-and-drop MP4/MP3 or URL input
- Once Critical Mention API key arrives, this becomes automated

---

## Non-Goals (Phase 1)

These are explicitly **out of scope** for the initial build:

- Client-facing portal (Big AL replacement)
- Auto-notification system (email distribution)
- FEC API integration for spender matching
- Critical Mention API polling (manual upload until API key arrives)
- User accounts / role-based access (single shared internal tool)
- Mobile-responsive design (desktop-first for ops team)

---

## Success Criteria

Phase 1 is done when:

1. ✅ TMG ops team can see all incoming emails and their processing status
2. ✅ Extracted buys display with full station/market/dollar breakdowns
3. ✅ Review queue surfaces items needing human attention
4. ✅ Team can upload a clip and see it transcribed + analyzed
5. ✅ Spender directory shows all known spenders with buy history
6. ✅ System runs on Cloud Run alongside the existing ingest service

---

## Open Questions

1. **Auth model:** Simple shared API key? Google IAM? IP whitelist? (Recommendation: start with IAM since it's already GCP)
2. **Real-time updates:** Polling vs. WebSocket for new email notifications? (Recommendation: polling every 30s for Phase 1)
3. **Data retention:** How far back should the email queue display? All time, or rolling 30/90 days?
4. **Existing data:** Are there buys already in BigQuery from prior testing that should be cleaned out before go-live?
5. **TMG team access:** Do they need GCP console access, or is the ops console their only interface?
