# Database Migrations

Terraform manages the Cloud SQL instance (`amplify-db`) but NOT the schema.
Schema changes are applied manually via these migration scripts.

## How to run

No psql installed locally. Use Python asyncpg:

```bash
DB_PASS=$(gcloud secrets versions access latest --secret=db-password --project=proj-amplify)
python3 -c "
import asyncio, asyncpg
async def run():
    conn = await asyncpg.connect(host='35.225.87.123', database='amplify', user='amplify', password='${DB_PASS}', ssl='require')
    await conn.execute(open('infra/migrations/<migration>.sql').read())
    print('Done')
    await conn.close()
asyncio.run(run())
"
```

## Applied migrations

| Date | File | Status |
|------|------|--------|
| Initial | `infra/schema.sql` | ✅ Applied |
| 2026-04-07 | `2026-04-07-dayparts-and-indexes.sql` | ✅ Applied |
