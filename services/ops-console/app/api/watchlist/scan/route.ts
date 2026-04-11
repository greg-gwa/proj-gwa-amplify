import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { v2 } from '@google-cloud/run'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

const GCP_PROJECT  = process.env.GCP_PROJECT  || 'proj-amplify'
const GCP_LOCATION = process.env.GCP_LOCATION || 'us-central1'
const CLOUD_RUN_JOB = process.env.CLOUD_RUN_JOB || 'amplify-ingest-job'

// POST /api/watchlist/scan — trigger a CM ad scan scoped to watchlist markets
export async function POST(_request: NextRequest) {
  try {
    // Load watchlist market_ids from radar_config
    const configRows = await query<{ value: Record<string, unknown> }>(
      `SELECT value FROM radar_config WHERE key = $1`,
      ['watch_config']
    )
    const config = configRows[0]?.value ?? {}
    const marketIds = (config.market_ids as string[]) || []

    // Create the scan record so the caller can immediately poll for status
    const scanId = randomUUID()
    await query(
      `INSERT INTO cm_scans (id, status, created_at) VALUES ($1, 'queued', NOW())`,
      [scanId]
    )

    // Build env var overrides for the job execution
    const envOverrides: { name: string; value: string }[] = [
      { name: 'SCAN_ID', value: scanId },
    ]
    if (marketIds.length > 0) {
      envOverrides.push({ name: 'MARKET_IDS', value: JSON.stringify(marketIds) })
    }

    // Execute the Cloud Run Job (fire-and-forget — do NOT await the operation result)
    const jobsClient = new v2.JobsClient()
    const jobName = `projects/${GCP_PROJECT}/locations/${GCP_LOCATION}/jobs/${CLOUD_RUN_JOB}`
    await jobsClient.runJob({
      name: jobName,
      overrides: {
        containerOverrides: [{ env: envOverrides }],
      },
    })

    return NextResponse.json({ ok: true, scan_id: scanId, status: 'queued' })
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
