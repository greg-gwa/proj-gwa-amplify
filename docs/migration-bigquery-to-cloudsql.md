# Migration Plan: BigQuery → Cloud SQL Postgres

## Why
BigQuery is an analytics warehouse, not an operational DB. Current pain:
- Streaming buffer prevents immediate reads after writes (30-min delay for DELETEs)
- No real UPDATE/UPSERT — workarounds everywhere
- 1-2s query latency for simple lookups (spins up a query job each time)
- Pay-per-scan cost model wrong for frequent small dashboard queries

## Target
**Cloud SQL Postgres 16** in `proj-amplify`, `us-central1` (same region as Cloud Run).

## Instance Spec
- **Tier:** `db-f1-micro` (1 vCPU, 0.6GB RAM) — upgrade later if needed
- **Storage:** 10GB SSD (auto-increase enabled)
- **HA:** Off (single zone is fine for now)
- **Backups:** Daily automated
- **Connections:** Cloud Run connects via Cloud SQL Auth Proxy (built into Cloud Run)

## Schema Migration

16 tables. Key type mappings:
| BigQuery | Postgres |
|----------|----------|
| STRING (REQUIRED) | TEXT NOT NULL |
| STRING | TEXT |
| INTEGER | INTEGER |
| FLOAT | NUMERIC(14,2) (dollars) or DOUBLE PRECISION |
| TIMESTAMP | TIMESTAMPTZ |
| DATE | DATE |
| BOOLEAN | BOOLEAN |
| REPEATED STRING | TEXT[] |

### Postgres improvements over BQ schema:
- **Primary keys** on `id` columns (BQ has no PKs)
- **Foreign keys** (buy_lines → buys, buy_line_weeks → buy_lines, buys → spenders, etc.)
- **Indexes** on common lookups (spenders.name, buys.source_email_id, buy_lines.buy_id, etc.)
- **UNIQUE constraints** (contacts.email, spenders dedup on normalized name)
- **Proper UPSERT** for contacts and spenders (ON CONFLICT DO UPDATE)
- **DEFAULT NOW()** on created_at/updated_at columns
- **ENUM types** for status fields (new, pending, review, confirmed, etc.)

## Code Changes

### 1. Ingest Service (Python/FastAPI)
- Replace `google-cloud-bigquery` with `asyncpg`
- Replace `BQ.insert_rows_json()` with `INSERT` statements
- Replace `BQ.query()` lookups with parameterized `SELECT`
- Spender dedup becomes a proper `INSERT ... ON CONFLICT(name_normalized) DO UPDATE`
- Contact dedup becomes `INSERT ... ON CONFLICT(email) DO UPDATE`
- **Drop** `parse_attachments.py` pipe-delimited text hack — no change needed (that feeds Claude, not BQ)

### 2. Ops Console (Next.js)
- Replace `@google-cloud/bigquery` with `pg` (node-postgres)
- Replace `src/lib/bigquery.ts` with `src/lib/db.ts` (connection pool)
- Update all API routes: swap BQ SQL syntax → standard Postgres SQL
- Main changes: remove backtick table refs, `CURRENT_DATE('tz')` → `CURRENT_DATE AT TIME ZONE 'America/New_York'`, `CAST(x AS STRING)` → `x::TEXT`

### 3. Terraform
- Add `google_sql_database_instance` + `google_sql_database` + `google_sql_user`
- Add Cloud SQL connection to Cloud Run service
- Add DB password to Secret Manager
- Remove org policy override for public Cloud Run (can lock down once webhook auth is added)

### 4. Environment / Secrets
- `DATABASE_URL=postgresql://amplify:$PASSWORD@/amplify?host=/cloudsql/$CONNECTION_NAME`
- Store password in Secret Manager: `amplify-db-password`

## Migration Steps (ordered)

1. **Terraform** — provision Cloud SQL instance + DB + user + secret
2. **Schema** — run `schema.sql` to create all tables with PKs/FKs/indexes
3. **Ingest service** — swap to asyncpg, redeploy to Cloud Run
4. **Ops console** — swap to pg, test locally
5. **Verify** — send test email, confirm end-to-end
6. **Cleanup** — delete BigQuery dataset, remove BQ dependencies

## Timeline
- ~2-3 hours of coding work
- Cloud SQL instance takes ~5 min to provision
- No data to migrate (tables are empty)

## Cost
- Cloud SQL `db-f1-micro`: ~$7-10/month
- Removes BigQuery on-demand query costs (~$5/TB scanned)
- Net: roughly the same or cheaper
