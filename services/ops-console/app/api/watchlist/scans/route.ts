import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const rows = await query(
      `SELECT id, started_at::TEXT as started_at, completed_at::TEXT as completed_at,
              stations_scanned, filings_found, new_items, matched_items, errors
       FROM radar_scans
       ORDER BY started_at DESC
       LIMIT 25`
    )
    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('Scans API error:', error)
    return NextResponse.json({ error: 'Failed to fetch scans' }, { status: 500 })
  }
}
