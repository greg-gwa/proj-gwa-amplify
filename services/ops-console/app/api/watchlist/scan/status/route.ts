import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/watchlist/scan/status?scan_id=<uuid>
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const scanId = searchParams.get('scan_id')

    if (!scanId) {
      return NextResponse.json({ error: 'Missing scan_id' }, { status: 400 })
    }

    const rows = await query(
      `SELECT id::TEXT, status,
              total_monitors, scanned_monitors,
              total_days, scanned_days,
              clips_found, clips_matched, clips_orphaned,
              cm_requests_used,
              error_details,
              started_at::TEXT, completed_at::TEXT, created_at::TEXT
       FROM cm_scans
       WHERE id = $1`,
      [scanId]
    )

    if (!rows[0]) {
      return NextResponse.json({ error: 'Scan not found' }, { status: 404 })
    }

    return NextResponse.json({ ok: true, data: rows[0] })
  } catch (error) {
    console.error('Scan status error:', error)
    return NextResponse.json({ error: 'Failed to fetch scan status' }, { status: 500 })
  }
}
