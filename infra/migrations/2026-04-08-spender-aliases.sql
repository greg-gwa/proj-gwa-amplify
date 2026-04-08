-- Spender aliases table: allows exact-match lookups by alternate names
-- before falling back to fuzzy matching.

CREATE TABLE IF NOT EXISTS spender_aliases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    spender_id  UUID NOT NULL REFERENCES spenders(id) ON DELETE CASCADE,
    alias       TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spender_aliases_alias_norm
    ON spender_aliases(UPPER(TRIM(alias)));

CREATE INDEX IF NOT EXISTS idx_spender_aliases_spender_id
    ON spender_aliases(spender_id);
