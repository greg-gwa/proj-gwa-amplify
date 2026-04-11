-- Add thumbnail support to ad_clips
-- 2026-04-11

ALTER TABLE ad_clips ADD COLUMN IF NOT EXISTS thumbnail_storage_path TEXT;

CREATE INDEX IF NOT EXISTS idx_ad_clips_thumbnail ON ad_clips(id) WHERE thumbnail_storage_path IS NOT NULL;
