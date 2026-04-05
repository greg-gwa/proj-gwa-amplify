import { Pool, QueryResultRow } from 'pg'

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    if (process.env.DATABASE_URL) {
      pool = new Pool({ connectionString: process.env.DATABASE_URL })
    } else {
      // Uses PGHOST, PGUSER, PGPASSWORD, PGDATABASE env vars automatically
      pool = new Pool()
    }
  }
  return pool
}

export async function query<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const p = getPool()
  const result = await p.query<T>(sql, params)
  return result.rows
}

export { getPool as pool }
