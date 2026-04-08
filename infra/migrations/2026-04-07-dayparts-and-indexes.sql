-- Migration: 2026-04-07 — Daypart table + radar matching index
-- Run against amplify DB on Cloud SQL (amplify-db)

-- 1. Daypart rotation detail for buy lines
CREATE TABLE IF NOT EXISTS buy_line_dayparts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buy_line_id     UUID NOT NULL REFERENCES buy_lines(id),
    daypart         TEXT,           -- e.g. "Early Morning", "Daytime", "Prime", "Late News"
    program         TEXT,           -- e.g. "Morning News", "Wheel of Fortune"
    days            TEXT,           -- e.g. "M-F", "Sa-Su", "M-Su"
    time_start      TEXT,           -- e.g. "05:00"
    time_end        TEXT,           -- e.g. "07:00"
    rate_per_spot   NUMERIC(10,2),
    spots_per_week  INTEGER,
    total_spots     INTEGER,
    total_dollars   NUMERIC(14,2),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_buy_line_dayparts_line_id ON buy_line_dayparts(buy_line_id);

-- 2. Partial index for radar → buy matching (critical for buys page performance)
-- Without this, every buys page load does a seq scan of 536K+ radar_items rows
CREATE INDEX IF NOT EXISTS idx_radar_items_matched_buy_id 
    ON radar_items(matched_buy_id) WHERE matched_buy_id IS NOT NULL;
