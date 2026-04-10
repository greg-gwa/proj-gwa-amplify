-- CM Ad Scanner migration
-- 2026-04-09

-- New table: tracks each batch scan job
CREATE TABLE IF NOT EXISTS cm_scans (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status           TEXT NOT NULL DEFAULT 'queued',  -- queued, running, complete, error
    total_monitors   INTEGER DEFAULT 0,
    scanned_monitors INTEGER DEFAULT 0,
    total_days       INTEGER DEFAULT 0,
    scanned_days     INTEGER DEFAULT 0,
    clips_found      INTEGER DEFAULT 0,
    clips_matched    INTEGER DEFAULT 0,
    clips_orphaned   INTEGER DEFAULT 0,
    cm_requests_used INTEGER DEFAULT 0,
    error_details    TEXT,
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- New table: every CM API request logged for budget tracking
CREATE TABLE IF NOT EXISTS cm_request_log (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id    UUID REFERENCES cm_scans(id),
    endpoint   TEXT,       -- 'session', 'channels', 'search', 'stream'
    channel_id INTEGER,
    station    TEXT,
    request_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add CM channel ID to stations for search routing
ALTER TABLE stations ADD COLUMN IF NOT EXISTS cm_channel_id INTEGER;

-- Extend ad_clips with CM scan fields
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS cm_scan_id          UUID REFERENCES cm_scans(id);
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS monitor_id          UUID;
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS spender_id          UUID REFERENCES spenders(id);
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS detection_method    TEXT;   -- 'cc_search' | 'gap_scan'
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS video_storage_path  TEXT;
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS air_date            DATE;
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS air_time            TEXT;
ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS matched_spender_name TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cm_scans_created_at      ON cm_scans(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cm_request_log_scan_id   ON cm_request_log(scan_id);
CREATE INDEX IF NOT EXISTS idx_ad_clips_cm_scan_id      ON ad_clips(cm_scan_id) WHERE cm_scan_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ad_clips_air_date         ON ad_clips(air_date)   WHERE air_date IS NOT NULL;
