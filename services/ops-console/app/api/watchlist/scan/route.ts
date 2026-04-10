import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

const INGEST_URL = process.env.INGEST_URL || 'https://amplify-ingest-910892119253.us-central1.run.app'

// POST /api/watchlist/scan — trigger a CM ad scan scoped to watchlist markets
export async function POST(request: NextRequest) {
  try {
    // Load watchlist market_ids from radar_config
    const configRows = await query<{ value: Record<string, unknown> }>(
      `SELECT value FROM radar_config WHERE key = $1`,
      ['watch_config']
    )
    const config = configRows[0]?.value ?? {}
    const marketIds = (config.market_ids as string[]) || []

    const resp = await fetch(`${INGEST_URL}/scan/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ market_ids: marketIds.length > 0 ? marketIds : undefined }),
    })

    if (!resp.ok) {
      const text = await resp.text()
      return NextResponse.json({ error: `Ingest service error: ${text}` }, { status: 502 })
    }

    const data = await resp.json()
    return NextResponse.json({ ok: true, scan_id: data.scan_id, status: data.status })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

// GET /api/watchlist/scan — return the most recent cm_scan
export async function GET() {
  try {
    const rows = await query(
      `SELECT id::TEXT, status,
              total_monitors, scanned_monitors,
              total_days, scanned_days,
              clips_found, clips_matched, clips_orphaned,
              cm_requests_used,
              error_details,
              started_at::TEXT, completed_at::TEXT, created_at::TEXT
       FROM cm_scans
       ORDER BY created_at DESC
       LIMIT 1`
    )

    return NextResponse.json({ ok: true, data: rows[0] ?? null })
  } catch (error) {
    console.error('Watchlist scan GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch scan' }, { status: 500 })
  }
}
