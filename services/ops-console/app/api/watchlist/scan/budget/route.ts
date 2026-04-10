import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

const CM_BUDGET_TOTAL = 1000

// GET /api/watchlist/scan/budget — returns CM API request usage and remaining budget
export async function GET() {
  try {
    const rows = await query<{ used: number }>(
      `SELECT COUNT(*)::INTEGER as used FROM cm_request_log`
    )

    const used = rows[0]?.used ?? 0
    const remaining = CM_BUDGET_TOTAL - used

    return NextResponse.json({
      ok: true,
      data: {
        total: CM_BUDGET_TOTAL,
        used,
        remaining,
        pct_used: Math.round((used / CM_BUDGET_TOTAL) * 100),
      },
    })
  } catch (error) {
    console.error('Budget API error:', error)
    return NextResponse.json({ error: 'Failed to fetch budget' }, { status: 500 })
  }
}
