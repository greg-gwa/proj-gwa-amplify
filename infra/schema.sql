-- Amplify — Postgres schema
-- Run against the `amplify` database after Cloud SQL instance is up.

-- ------------------------------------------------------------------
-- Pipeline Tables
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS raw_emails (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    received_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    from_address      TEXT,
    to_address        TEXT,
    subject           TEXT,
    body_text         TEXT,
    body_html         TEXT,
    raw_storage_path  TEXT,
    attachment_count  INTEGER,
    processed         BOOLEAN DEFAULT FALSE,
    processed_at      TIMESTAMPTZ
);

-- ------------------------------------------------------------------
-- Reference Data
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS markets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    dma_code    INTEGER,
    dma_rank    INTEGER,
    state       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS stations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_sign   TEXT NOT NULL,
    network     TEXT,
    market_id   UUID REFERENCES markets(id),
    market_name TEXT,
    owner       TEXT,
    media_type  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS districts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    state         TEXT,
    district_type TEXT,
    cycle_year    INTEGER,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS contacts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT,
    title      TEXT,
    company    TEXT,
    email      TEXT,
    phone      TEXT,
    stations   TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT contacts_email_unique UNIQUE (email)
);

-- ------------------------------------------------------------------
-- Spending Data
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS spenders (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    type        TEXT,
    agency      TEXT,
    party       TEXT,
    district_id UUID REFERENCES districts(id),
    fec_id      TEXT,
    notes       TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS buys (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    estimate_number         TEXT,
    spender_id              UUID NOT NULL REFERENCES spenders(id),
    spender_name            TEXT,
    agency                  TEXT,
    district_id             UUID REFERENCES districts(id),
    flight_start            DATE,
    flight_end              DATE,
    spot_length_seconds     INTEGER,
    total_dollars           NUMERIC(14,2),
    status                  TEXT,
    is_revision             BOOLEAN DEFAULT FALSE,
    revision_of_id          UUID,
    primary_support         TEXT,
    source_email_id         UUID REFERENCES raw_emails(id),
    source_format           TEXT,
    extraction_confidence   NUMERIC(4,3),
    raw_extraction_json     TEXT,
    notes                   TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS buy_lines (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buy_id                  UUID NOT NULL REFERENCES buys(id),
    station_call_sign       TEXT NOT NULL,
    station_id              UUID REFERENCES stations(id),
    market_name             TEXT,
    market_id               UUID REFERENCES markets(id),
    network                 TEXT,
    spot_length_seconds     INTEGER,
    total_dollars           NUMERIC(14,2),
    flight_start            DATE,
    flight_end              DATE,
    source_contact_name     TEXT,
    source_contact_email    TEXT,
    source_contact_phone    TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS buy_line_weeks (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buy_line_id   UUID NOT NULL REFERENCES buy_lines(id),
    week_start    DATE NOT NULL,
    week_end      DATE,
    dollars       NUMERIC(14,2),
    spots         INTEGER,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------
-- Creative Data
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS creatives (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spender_id            UUID REFERENCES spenders(id),
    title                 TEXT,
    ad_type               TEXT,
    description           TEXT,
    spot_length_seconds   INTEGER,
    transcript            TEXT,
    transcript_language   TEXT,
    clip_url              TEXT,
    storage_path          TEXT,
    thumbnail_path        TEXT,
    source_platform       TEXT,
    source_clip_id        TEXT,
    station_first_seen    TEXT,
    market_first_seen     TEXT,
    date_first_aired      DATE,
    date_uploaded         DATE,
    extraction_json       TEXT,
    sentiment             TEXT,
    keywords              TEXT[] DEFAULT '{}',
    themes                TEXT[] DEFAULT '{}',
    transcript_hash       TEXT,
    total_airings         INTEGER,
    first_detected_at     TIMESTAMPTZ,
    last_detected_at      TIMESTAMPTZ,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creative_assignments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creative_id UUID NOT NULL REFERENCES creatives(id),
    buy_line_id UUID NOT NULL REFERENCES buy_lines(id),
    traffic_pct INTEGER,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS creative_airings (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creative_id       UUID NOT NULL REFERENCES creatives(id),
    station_call_sign TEXT,
    market_name       TEXT,
    aired_at          TIMESTAMPTZ,
    daypart           TEXT,
    program           TEXT,
    source_clip_id    TEXT,
    source_platform   TEXT,
    confidence        NUMERIC(4,3),
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ad_clips (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_url              TEXT,
    source_platform         TEXT,
    media_type              TEXT,
    station_or_channel      TEXT,
    program                 TEXT,
    clip_duration_seconds   NUMERIC(8,2),
    transcript              TEXT,
    transcript_language     TEXT,
    transcript_confidence   NUMERIC(4,3),
    show_id                 UUID,
    show_title_extracted    TEXT,
    venue_extracted         TEXT,
    ad_type                 TEXT,
    advertiser              TEXT,
    dates_mentioned         TEXT[] DEFAULT '{}',
    prices_mentioned        TEXT[] DEFAULT '{}',
    call_to_action          TEXT,
    is_relevant             BOOLEAN,
    confidence              NUMERIC(4,3),
    raw_storage_path        TEXT,
    extraction_json         TEXT,
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    processed_at            TIMESTAMPTZ
);

-- ------------------------------------------------------------------
-- Scout / Early Warning
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radar_items (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fcc_filing_id     TEXT,
    station_call_sign TEXT,
    market_name       TEXT,
    spender_name      TEXT,
    spender_type      TEXT,
    flight_start      DATE,
    flight_end        DATE,
    total_dollars     NUMERIC(14,2),
    filing_url        TEXT,
    filing_storage_path TEXT,
    status            TEXT,
    matched_buy_id    UUID REFERENCES buys(id),
    notes             TEXT,
    detected_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------
-- Active Monitoring
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS watch_list (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buy_id            UUID NOT NULL REFERENCES buys(id),
    buy_line_id       UUID NOT NULL REFERENCES buy_lines(id),
    spender_id        UUID REFERENCES spenders(id),
    spender_name      TEXT,
    station_call_sign TEXT,
    market_name       TEXT,
    flight_start      DATE,
    flight_end        DATE,
    is_active         BOOLEAN DEFAULT TRUE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------
-- Notifications
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type                TEXT NOT NULL,
    district_id         UUID REFERENCES districts(id),
    subject             TEXT,
    body                TEXT,
    recipients          TEXT[] DEFAULT '{}',
    related_buy_id      UUID REFERENCES buys(id),
    related_creative_id UUID REFERENCES creatives(id),
    sent_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_buys_source_email_id    ON buys(source_email_id);
CREATE INDEX IF NOT EXISTS idx_buys_spender_id         ON buys(spender_id);
CREATE INDEX IF NOT EXISTS idx_buy_lines_buy_id        ON buy_lines(buy_id);
CREATE INDEX IF NOT EXISTS idx_buy_line_weeks_line_id   ON buy_line_weeks(buy_line_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_spenders_name_norm ON spenders(UPPER(TRIM(name)));
CREATE INDEX IF NOT EXISTS idx_spenders_name           ON spenders(name);
CREATE INDEX IF NOT EXISTS idx_buys_created_at         ON buys(created_at);
CREATE INDEX IF NOT EXISTS idx_ad_clips_created_at     ON ad_clips(created_at);
CREATE INDEX IF NOT EXISTS idx_raw_emails_received_at  ON raw_emails(received_at);
CREATE INDEX IF NOT EXISTS idx_radar_items_created_at  ON radar_items(created_at);

-- ------------------------------------------------------------------
-- Radar Configuration & Scan History
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS radar_config (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key        TEXT NOT NULL UNIQUE,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS radar_scans (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at       TIMESTAMPTZ NOT NULL,
    completed_at     TIMESTAMPTZ,
    stations_scanned INTEGER DEFAULT 0,
    filings_found    INTEGER DEFAULT 0,
    new_items        INTEGER DEFAULT 0,
    matched_items    INTEGER DEFAULT 0,
    errors           INTEGER DEFAULT 0,
    error_details    TEXT,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_radar_items_fcc_filing_id ON radar_items(fcc_filing_id);
CREATE INDEX IF NOT EXISTS idx_radar_scans_started_at ON radar_scans(started_at);

-- ------------------------------------------------------------------
-- FEC Reference Data
-- ------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fec_committees (
    cmte_id          TEXT PRIMARY KEY,
    cmte_name        TEXT,
    cmte_type        TEXT,
    cmte_designation TEXT,
    cmte_party       TEXT,
    connected_org    TEXT,
    cand_id          TEXT,
    treasurer_name   TEXT,
    city             TEXT,
    state            TEXT,
    zip              TEXT,
    source_cycle     INTEGER,
    load_date        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fec_candidates (
    cand_id          TEXT PRIMARY KEY,
    cand_name        TEXT,
    party            TEXT,
    party_full       TEXT,
    office           TEXT,
    state            TEXT,
    district         TEXT,
    incumbent_status TEXT,
    election_year    INTEGER,
    source_cycle     INTEGER,
    load_date        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fec_committees_name ON fec_committees(UPPER(cmte_name));
CREATE INDEX IF NOT EXISTS idx_fec_committees_cand_id ON fec_committees(cand_id);
CREATE INDEX IF NOT EXISTS idx_fec_candidates_name ON fec_candidates(UPPER(cand_name));
