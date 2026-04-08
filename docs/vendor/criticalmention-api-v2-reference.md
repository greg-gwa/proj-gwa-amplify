# Critical Mention API v2 Reference

**Source:** https://app.criticalmention.com/doc/2.0/
**Swagger Spec:** `criticalmention-api-v2-swagger.json` (in this directory)
**Version:** 4.12 (updated 03-30-2026)
**Base URL:** `https://app.criticalmention.com/allmedia`

## Authentication

1. POST `/session` with `username` + `password` → returns session token (`id`)
2. Use token in `Authorization` header for all subsequent calls

## Endpoints

### Session
| Method | Path | Description |
|--------|------|-------------|
| POST | `/session` | Authenticate, get session token |

### Channel
| Method | Path | Description |
|--------|------|-------------|
| GET | `/channel` | List channels (filter: `active`, `broadcastType`) |
| GET | `/channel/{id}` | Channel details |
| GET | `/channel/channelMarkets` | Channels + markets (filter: `mediaType=tv\|radio`) |

### Clip
| Method | Path | Description |
|--------|------|-------------|
| GET | `/clip` | List clips (pagination, sort, filter by keyword/name/mediaType/archive) |
| GET | `/clip/{id}` | Clip details |
| PUT | `/clip/{id}` | Update clip (name, thumbnail, start/end, archive) |
| DELETE | `/clip/{id}` | Hard delete clip (permanent!) |
| GET | `/clip/{id}/thumbnail` | Clip thumbnail reference |

### Market
| Method | Path | Description |
|--------|------|-------------|
| GET | `/market` | All broadcast markets |

### Program
| Method | Path | Description |
|--------|------|-------------|
| GET | `/program` | Search programs by title (filter: `alias=tv\|radio\|news`, date range) |

### Schedule
| Method | Path | Description |
|--------|------|-------------|
| GET | `/schedule` | Programming schedule (requires `channelId`, `minTime`, `maxTime`) |

### Search
| Method | Path | Description |
|--------|------|-------------|
| POST | `/search` | Full search — TV, radio, podcast, YouTube, online news |

## Search Parameters (Key Ones)

- `start` / `end` — date range (YYYY-MM-DD HH:MM:SS)
- `requiredKeywords` / `exactPhrase` / `anyKeywords` / `excludedKeywords` / `booleanQuery`
- `cTV=1` + `tvChannels` / `tvMarkets` / `tvStates` / `tvNetworks` / `tvGenres`
- `cRadio=1` + `radioChannels` / `radioMarkets` / `radioStates`
- `podcast=1` + `sourcePodcast` / `podcastCategory`
- `youtube=1` + `titleYoutube`
- `limit` (max 500) / `page` / `sortOrder`
- `filterSyndicated=1` — dedup syndicated content
- `licensedOnly=1` — licensed content only
- `languageCode` — ISO 639-1 codes

## Search Response Fields (per clip)

- `uuid` — unique clip identifier
- `callSign` — station call letters (WCBS, KNBC, CNN)
- `channelId` — numeric station ID
- `title` — program title (from Nielsen)
- `ccText` — closed caption / transcript text (60-sec clip)
- `timestamp` — UTC (yyyyMMddHHmmss)
- `duration` — clip length in seconds (always 60)
- `mediaUrl` — Wordplay player URL (embeddable)
- `media` — direct stream URL (HLS m3u8)
- `thumbnailUrl` — thumbnail image
- `adValue` / `localAdValue` — publicity dollar value (SQAD)
- `numHouseholds` / `localNumHouseholds` — audience (Nielsen)
- `marketName` / `marketRank` / `marketState` — DMA info
- `genre` — News, Talk, Public Affairs, etc.
- `alias` — media type (tv, radio, news, podcast, youtube)
- `broadcastType` — National Cable, National Broadcast, US Radio, etc.

## Notes

- All clips are 60-second segments
- `media` field provides direct HLS stream URLs (potential for audio extraction)
- `mediaUrl` is the Wordplay editor (embeddable player, extends beyond 60 sec)
- Boolean search supports AND/OR/NOT, wildcards (*/?), proximity (~), grouping
- Time format for schedule: `yyyyMMddHHmmss`
