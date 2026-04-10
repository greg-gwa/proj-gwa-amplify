-- Migration: Kill the monitors table
-- Date: 2026-04-09
-- Reason: Watchlist and CM scanner now query radar_items + buy_lines directly.
--         The monitors table was a stale pre-materialized cache; removing it
--         eliminates the staleness bug and the build_monitors pipeline step.

DROP TABLE IF EXISTS monitors CASCADE;
