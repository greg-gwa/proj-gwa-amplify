# Amplify Ops Console — Team Briefing

**Date:** April 5, 2026
**From:** Greg Tusar / Greywolf Analytics

---

## What Is This?

Amplify is an AI-powered competitive intelligence platform for political advertising. It automates what currently takes 30-45 minutes of manual work per ad buy — pulling FCC filings, extracting spending data, matching ads to candidates, and surfacing it all in a single dashboard.

**As of today, the Ops Console is live in production.**

---

## Getting Started

### Login

**URL:** [https://almedia.gwanalytics.ai](https://almedia.gwanalytics.ai)
**Password:** `callmeAL`

That's it. No accounts to create, no setup. Enter the password and you're in.

The session lasts 30 days — you won't need to log in again unless you clear your cookies or switch browsers.

---

## What You'll See

The console is organized into four sections via the left sidebar:

### 📊 Station Buys

**Dashboard** — High-level pipeline stats: emails processed, filings indexed, pending review items, recent activity.

**Buys** — Station-level ad buy data ingested from email confirmations. When stations email buy confirmations to our Mailgun address, Claude (AI) automatically extracts the structured data — spender, stations, markets, dollar amounts, flight dates — and stores it here.

**Spenders** — Directory of every political advertiser we've identified. Campaigns, PACs, Super PACs, issue organizations. Click any spender to see all their associated buys and filings.

**Review Queue** — Items that need human attention: new spenders the system hasn't seen before, low-confidence AI extractions, revised buys that need approval.

### 👁 Creative Monitoring

**Watchlist** — This is your regional monitoring view. Select the DMA markets you care about using the search bar at the top (e.g., "Washington DC", "Philadelphia", "Atlanta"). The system will show you every active ad monitoring window in those markets — which spenders are running ads, on which stations, during which time slots and days of the week, and for how long.

The data comes from FCC political filing contracts that we've parsed with AI. Each row represents a specific time slot where a political ad is scheduled to air.

**Clips** — When we integrate a broadcast monitoring service (Critical Mention or TVEyes — more on this below), captured ad clips will appear here. You'll be able to play them in-browser, read AI-generated transcripts, and filter by spender, market, or date.

### 📡 FCC Scanner

**Radar** — The raw FCC political filing data. Every filing from every TV station in the country, parsed and classified. Defaults to showing contracts (the most useful document type), but you can filter to see invoices, NAB forms, etc. Click the PDF button to view the original FCC filing.

Currently showing filings from 2026. As of this morning, we've indexed **49,455 filings** across **1,258 stations** from **73,933 unique spenders**, representing over **$37 million** in political ad spend — and we're still parsing (April is 100% complete, working backwards through March).

**Scanner** — Operational view of the automated hourly FCC scanner. Runs every hour, checks all stations for new political filings, and adds them to the Radar. You can see recent scan history and trigger a manual scan if needed.

### 💡 Intelligence

**Intelligence** — An AI analyst you can chat with. Ask it anything about the data:

- *"Who are the top 10 spenders this month?"*
- *"Show me all buys in the Atlanta market"*
- *"How much has David Trone spent across all stations?"*
- *"Compare Republican vs Democrat spending in Virginia"*

It writes SQL queries against the full database in real time. You can ask follow-up questions — it remembers context within your session.

---

## What's Working Right Now

| Capability | Status |
|-----------|--------|
| FCC filing ingestion (all US TV stations) | ✅ Live — 49,455 filings indexed |
| Hourly automated scanning | ✅ Live — runs on the hour |
| AI extraction of contracts (spender, dollars, flights) | ✅ Live — processing 240/hr |
| Email buy ingestion (Mailgun → AI extraction) | ✅ Live |
| Regional watchlist / monitoring windows | ✅ Live |
| AI Intelligence chat | ✅ Live |
| Production deployment with SSL | ✅ Live at almedia.gwanalytics.ai |
| PDF archival to Google Cloud Storage | ✅ Live |

---

## What's Coming Next

### Creative Capture (Critical Mention / TVEyes)

The biggest missing piece is **capturing the actual ad clips** — the video/audio of the ads as they air on TV. This is what the Clips page is built for.

We're evaluating two providers:

**Critical Mention** — Meeting scheduled this week. They have a web platform for searching broadcast content by market/station/date and clipping ads. We're exploring their API for automated integration.

**TVEyes** — Backup option. They offer 3,300+ stations, 43 countries, and a suite of APIs for search, clip embedding, and real-time monitoring. Their Saved Search API maps well to our monitoring windows.

**The integration plan:**
1. Our Watchlist tells us *where and when* to look (station + time window + days)
2. The clip provider tells us *what actually aired* during those windows
3. We match clips to contracts, run them through Whisper (speech-to-text), and use Claude to analyze the creative (tone, claims, themes, sentiment)
4. The result shows up in the Clips page — fully transcribed, classified, and searchable

Once we have a clip provider wired in, the platform becomes a complete loop: **FCC data → monitoring windows → clip capture → AI analysis → intelligence.**

---

## Architecture (For the Curious)

```
FCC Public File API ──→ Hourly Scanner ──→ Radar (49K+ filings)
                                              │
                                              ▼
                                        AI PDF Parser (Claude)
                                              │
                                              ▼
                                     Contracts → Monitors → Watchlist
                                              
Station Emails ──→ Mailgun ──→ AI Extraction ──→ Buys

[Future]
Clip Provider ──→ Whisper ──→ Claude ──→ Clips
```

**Infrastructure:**
- Google Cloud (Cloud Run, Cloud SQL, Cloud Storage, Cloud Scheduler)
- AI: Anthropic Claude (extraction + intelligence), OpenAI Whisper (transcription)
- Database: PostgreSQL with 49K+ filings and growing
- Deployed at: `almedia.gwanalytics.ai`

---

## Tips

- **Radar loads fastest** with the "Contract" filter (default) — that's where the money data is
- **Intelligence remembers your conversation** — ask follow-ups naturally
- **Watchlist is most useful** when you select specific markets — try adding "Washington DC" or your target markets
- **Scanner page** is operational plumbing — check it if data looks stale
- **The system is actively parsing** — you'll see new data appear throughout the day as the batch parser works through March and earlier filings

---

## Questions?

Reach out to Greg. We're iterating fast — if something looks wrong or you have feature requests, flag them immediately.
