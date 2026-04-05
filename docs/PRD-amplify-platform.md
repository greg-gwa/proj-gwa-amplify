# Amplify Platform — Product Requirements Document

**Version:** 0.1 (Draft)
**Date:** March 31, 2026
**Author:** Greg Tusar / Greywolf Analytics

---

## Executive Summary

Amplify is an AI-powered competitive intelligence platform that automates the gathering, processing, and reporting of political advertising data. It replaces manual workflows that currently require 30-45 minutes per ad buy with an automated pipeline that processes incoming data in seconds.

The platform ingests competitive spending data from station representatives (via email), automatically extracts structured information using AI, matches ads to candidates and districts, and delivers real-time competitive intelligence to clients through a web portal.

---

## Problem Statement

### Current State
Political media tracking firms spend significant labor on repetitive data entry:

1. **Competitive Gathering** (~15-20 min per buy): Station reps email spending data as Excel/PDF attachments → staff manually copies fields into Google Sheets → re-enters into internal system → manually composes and sends competitive update emails to client distribution lists.

2. **Creative Gathering** (~20-30 min per ad): Staff manually searches Critical Mention by market/station/date → scrubs through video thumbnails → clips and downloads ads → re-uploads to internal system with manual metadata → composes and sends creative update emails.

These processes are:
- **Time-consuming:** 43+ manual steps for creative gathering alone
- **Error-prone:** Copy-paste between 4 different systems
- **Unscalable:** Linear labor cost per buy/creative processed
- **Competitively disadvantaged:** Other firms are automating

### Desired State
Email arrives → AI extracts all data → auto-matches to candidates/districts → clients see updates in real-time → staff only intervenes for edge cases.

**Target:** Reduce manual labor per buy from 20 minutes to <1 minute (review/approve only).

---

## Architecture

### High-Level System Diagram

```
DATA SOURCES                     PROCESSING                      CONSUMERS
─────────────                    ──────────                      ─────────

Station emails ─┐                                           ┌── Client Portal (Big AL)
(Excel, PDF)    │                                           │   • Spending dashboards
                ├──→ Mailgun ──→ Cloud Run ──→ BigQuery ──→┤   • Creative library
Critical        │    (inbound)   (ingest)     (truth)      │   • Alerts & reports
Mention clips ──┤                    │                      │
                │              Claude + Whisper              ├── Ops Console (Little AL)
Manual entry  ──┘              (AI extraction)              │   • Review queue
                                                            │   • Data corrections
                                                            │   • Distribution mgmt
                                                            │
                                                            └── Email Notifications
                                                                • Competitive updates
                                                                • Creative updates
```

### Infrastructure

| Component | Technology | Location |
|-----------|-----------|----------|
| **GCP Project** | `proj-amplify` | gwanalytics.ai org |
| **Email Ingestion** | Mailgun → Cloud Run webhook | `amplify.gwanalytics.ai` |
| **AI Extraction** | Claude (Anthropic) — structured data from email/attachments |
| **Transcription** | OpenAI Whisper API — audio/video clip transcription |
| **Database** | BigQuery | `proj-amplify.amplify` |
| **File Storage** | Cloud Storage | `gs://amplify-raw-emails` |
| **Container Registry** | Artifact Registry | `amplify-app` |
| **Secrets** | Secret Manager | API keys for Anthropic, OpenAI, Mailgun |
| **Frontend** | Next.js on Cloud Run | TBD |
| **IaC** | Terraform | `infra/` directory |

### Design Principles

1. **Transferable:** Entire platform lives in one GCP project. Handoff = `gcloud projects move`.
2. **No proprietary dependencies:** Standard GCP services + public APIs. No vendor lock-in.
3. **AI in the pipeline, not the infrastructure:** LLMs process data but don't own the runtime. Pipeline works without AI for manual entry fallback.
4. **Human-in-the-loop:** AI handles the bulk work; humans review edge cases via the review queue.

---

## Data Model

### Entity Relationship Overview

```
markets ←── stations
                ↑
spenders ──→ buys ──→ buy_lines ──→ buy_line_weeks
  ↑            ↑          ↑
  │            │          │
districts      │    creative_assignments
               │          ↑
          raw_emails   creatives
                          ↑
                      ad_clips (Critical Mention)
```

### Core Tables

#### Reference Data (relatively static)

| Table | Description | Key Fields |
|-------|------------|------------|
| **markets** | DMA media markets | name, dma_code, dma_rank, state |
| **stations** | TV/radio stations | call_sign, network, market, owner, media_type |
| **districts** | Political districts | name, state, district_type, cycle_year |
| **contacts** | Station rep contacts | name, title, company, email, phone, stations[] |

#### Spending Data (core business logic)

| Table | Description | Key Fields |
|-------|------------|------------|
| **spenders** | PACs, campaigns, orgs | name, type, agency, party, district_id, fec_id |
| **buys** | Master buy record | estimate_number, spender_id, flight_start/end, spot_length, total_dollars, status, is_revision |
| **buy_lines** | Per-station breakdown | buy_id, station_call_sign, market_name, total_dollars, contact info |
| **buy_line_weeks** | Weekly spend within a flight | buy_line_id, week_start, dollars, spots |

#### Creative Data

| Table | Description | Key Fields |
|-------|------------|------------|
| **creatives** | Ad clips matched to spenders | title, ad_type, description, transcript, clip_url, storage_path |
| **creative_assignments** | Creative ↔ buy_line mapping | creative_id, buy_line_id, traffic_pct |
| **ad_clips** | Raw Critical Mention clips | source_url, transcript, media_type, station, extraction_json |

#### Pipeline & Ops

| Table | Description | Key Fields |
|-------|------------|------------|
| **raw_emails** | Email audit trail | from, to, subject, body, attachments, processed flag |
| **notifications** | Competitive/creative updates sent | type, district_id, subject, body, recipients[], sent_at |

---

## Automated Pipelines

### Pipeline 1: Competitive Spending Ingestion

**Trigger:** Email arrives at `*@amplify.gwanalytics.ai`

```
Step 1: RECEIVE
  Mailgun receives email → POSTs to Cloud Run /inbound endpoint

Step 2: STORE RAW
  Raw email stored in BigQuery (raw_emails) + Cloud Storage (backup)

Step 3: EXTRACT (AI)
  Claude analyzes email body + attachments (Excel, PDF)
  Extracts: estimate #, spender, agency, stations, markets,
            flight dates, spot length, dollar amounts per station

Step 4: MATCH SPENDER
  ├── Known spender → auto-assign to candidate/district
  ├── FEC match found → auto-assign, flag as new
  └── No match → queue for human review

Step 5: STORE STRUCTURED
  Create/update: buys, buy_lines, buy_line_weeks
  Handle revisions: detect "REVISED" flag, link to original buy

Step 6: NOTIFY (if auto-matched)
  Generate competitive update → send to district distribution list
```

**Input formats handled:**
- Excel spreadsheets (.xlsx) — various column layouts per station group
- PDF documents — email confirmations with totals
- Plain text emails — spending info in body
- Mixed — some emails contain multiple station buys

### Pipeline 2: Creative Gathering (Ad Clips)

**Trigger:** API call with clip URL, or Critical Mention API integration

```
Step 1: RECEIVE
  POST /clip with { url, media_type, station, source_platform }

Step 2: TRANSCRIBE
  Whisper API transcribes audio/video → text

Step 3: EXTRACT (AI)
  Claude analyzes transcript:
  - Is this a political ad?
  - Which spender/candidate?
  - What's the ad about?
  - Ad type (promo, attack, issue, etc.)

Step 4: MATCH
  Match to existing spender + active buys by:
  - Spender name in transcript
  - Station + market + date range overlap
  - Keyword matching

Step 5: STORE
  Save creative with metadata, transcript, clip file
  Create creative_assignment linking to buy_line

Step 6: NOTIFY
  Generate creative update → send to district distribution list
```

### Pipeline 3: Auto-Notification

**Trigger:** New buy or creative processed and matched

```
Competitive Update Email:
  Subject: "{District} Competitive Update"
  Body: Auto-generated summary of new spending
  Recipients: From notification manager distribution list

Creative Update Email:
  Subject: "{District} Creative Update: {Spender}"
  Body: Auto-generated with creative details + thumbnail
  Recipients: From notification manager distribution list
```

---

## User Interfaces

### 1. Ops Console (Internal — replaces Little AL)

**Users:** Amplify staff (analysts, data entry team)

#### Dashboard
- Pipeline status (emails processed today, pending, errors)
- Review queue count
- Recent activity feed

#### Review Queue
Priority-ordered list of items needing human attention:
- **🔴 New Spender** — unknown spender, needs district/candidate assignment
- **🟡 Low Confidence** — AI extraction below threshold, needs verification
- **🟡 Revision** — buy marked as revised, needs approval
- **🔵 Missing Creative** — active buy with no matched creative yet

Each queue item shows:
- Spender name, estimate #, stations, markets, dollar amounts
- AI suggestion (if any) with confidence score
- One-click actions: Approve, Edit, Assign, Skip

#### Data Management
- Spender directory (create, edit, merge, assign to districts)
- Station/market reference data
- District/cycle configuration

#### Notification Manager
- Distribution list management per district
- Email template configuration
- Send history / audit log

#### Manual Entry Fallback
- Form-based buy entry (mirrors old Little AL flow)
- For cases where email automation fails

### 2. Client Portal (External — replaces Big AL)

**Users:** Campaign staff, political consultants, party committees

#### Competitive Dashboard
- Spending by district, market, spender, time period
- Sortable/filterable tables
- Charts: spending over time, market share, station mix

#### Creative Library
- Searchable grid of ad clips with thumbnails
- Play in browser
- Transcript view
- Filter by spender, district, date, ad type

#### Alerts
- Real-time notifications when new buys/creatives detected
- Configurable alert preferences

#### Reports
- Exportable competitive summaries
- Scheduled report delivery (daily/weekly digest)

---

## Spender Auto-Matching

### Tier 1: Known Spender (Target: 80%)
Exact or fuzzy match against existing `spenders` table.
- "One Giant Leap PAC" → already in system → auto-assign
- Fuzzy: "One Giant Leap" vs "ONE GIANT LEAP PAC" → match

### Tier 2: FEC Lookup (Target: 15%)
New spender → query FEC API by committee name → match candidate/party.
- Cross-reference media markets to narrow district
- Auto-assign if confidence > 0.9

### Tier 3: Human Review (Target: 5%)
- Dark money groups, generic names
- New PACs with no FEC record
- Queued in Ops Console for manual assignment
- Once assigned, all future buys from this spender auto-match

---

## Critical Mention Integration

### Current State
Manual search, clip, download, re-upload process (43 steps).

### Near-Term (API not yet available)
- Staff downloads clips from Critical Mention
- Emails clips to `clips@amplify.gwanalytics.ai` or uploads via Ops Console
- Whisper + Claude handle transcription and extraction

### Future (Critical Mention API)
- Automated polling by market/station/date range
- Auto-download new clips matching active buys
- Zero-touch creative gathering

### Critical Mention Collaboration
- CM working on universal transcription (enhances keyword search)
- API access in development (enables automated extraction)
- Amplify's Whisper-based transcription works independently in the meantime

---

## Technical Implementation Status

### ✅ Complete
- GCP project (`proj-amplify`) with billing, APIs, IAM
- Terraform IaC (full infrastructure-as-code)
- Mailgun domain (`amplify.gwanalytics.ai`) with MX, SPF, DKIM
- Cloud Run ingest service (email → Claude → BigQuery)
- BigQuery schema (16 tables — reference, spending, creative, pipeline)
- Cloud Storage bucket (raw email archive)
- Artifact Registry (container images)
- End-to-end email pipeline tested and working

### 🔧 In Progress
- Competitive spending extraction prompt (tuned to real sample buys)
- Ad clip transcription pipeline (Whisper + Claude)
- Excel/PDF attachment parsing

### 📋 To Build
- Ops Console (Next.js — review queue, data management, notification manager)
- Client Portal (Next.js — dashboards, creative library, reports)
- Spender auto-matching (FEC integration, fuzzy matching)
- Auto-notification system (competitive + creative updates)
- Critical Mention integration (manual flow first, API when available)

---

## Handoff Plan

The platform is designed for clean transfer:

1. **Infrastructure:** `gcloud projects move proj-amplify --organization=NEW_ORG_ID`
2. **Code:** Git repository with all services, Terraform, docs
3. **Terraform:** `terraform apply` rebuilds entire infrastructure from zero
4. **Mailgun:** Transfer account or create new, update DNS
5. **API Keys:** Rotate Anthropic + OpenAI keys, update Secret Manager
6. **Domain:** Swap to `amplify.ai` (or whatever domain) via DNS update

**No dependencies on:**
- Greywolf Analytics infrastructure
- Any personal accounts or credentials
- Proprietary tools or frameworks

---

## Appendix: Sample Data Formats

### Format A: Email with PDF (ABC/Disney)
```
From: nick.brown@disney.com
Subject: Political Orders
Attachment: PDF with spender, estimate #, flight dates, total
```

### Format B: Email with Excel (CW/Independent)
```
From: station-rep@nexstar.com
Attachment: .xlsx with columns:
  Market | Station | Week dates | Dollar amounts | Station Total
```

### Format C: Master Political Order List (FOX)
```
Attachment: Multi-page PDF/spreadsheet listing ALL political orders
Highlighted rows = new/recent orders
Includes: station, advertiser, estimate #, flight dates, total, status
```

### Format D: Email Body Only
```
Plain text email from station rep:
"One Giant Leap PAC, Est 14510, 5/27-6/2, $126,200 on WABC"
```

All formats handled by the same Claude extraction pipeline.
