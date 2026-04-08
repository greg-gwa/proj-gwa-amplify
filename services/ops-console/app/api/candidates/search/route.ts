import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 50)

    if (!q || q.length < 2) {
      return NextResponse.json({ data: [] })
    }

    const rows = await query(
      `SELECT
         fc.cand_id, fc.cand_name, fc.party, fc.office, fc.state, fc.district,
         (SELECT COUNT(DISTINCT s.id) FROM spenders s
          JOIN fec_committees cm ON cm.cmte_id = s.fec_id
          WHERE cm.cand_id = fc.cand_id) as total_spenders,
         (SELECT COALESCE(SUM(b.total_dollars), 0) FROM buys b
          JOIN spenders s ON s.id = b.spender_id
          JOIN fec_committees cm ON cm.cmte_id = s.fec_id
          WHERE cm.cand_id = fc.cand_id) as total_dollars
       FROM fec_candidates fc
       WHERE LOWER(fc.cand_name) LIKE LOWER($1)
       ORDER BY fc.cand_name
       LIMIT $2`,
      [`%${q}%`, limit]
    )

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('Candidate search error:', error)
    return NextResponse.json({ error: 'Failed to search candidates' }, { status: 500 })
  }
}
