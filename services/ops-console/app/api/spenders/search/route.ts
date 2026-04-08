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
      `SELECT s.id, s.name, s.type, s.party,
              (SELECT COUNT(*) FROM buys b WHERE b.spender_id = s.id)::INTEGER as total_buys,
              (SELECT COALESCE(SUM(total_dollars), 0) FROM buys b WHERE b.spender_id = s.id) as total_dollars
       FROM spenders s
       WHERE LOWER(s.name) LIKE LOWER($1)
       ORDER BY s.name
       LIMIT $2`,
      [`%${q}%`, limit]
    )

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('Spender search error:', error)
    return NextResponse.json({ error: 'Failed to search spenders' }, { status: 500 })
  }
}
