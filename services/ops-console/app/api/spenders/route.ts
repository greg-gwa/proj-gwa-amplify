import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')
    const search = searchParams.get('search')
    const party = searchParams.get('party')
    const type = searchParams.get('type')

    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (search) {
      conditions.push(`LOWER(s.name) LIKE LOWER($${idx})`)
      params.push(`%${search}%`)
      idx++
    }
    if (party) {
      conditions.push(`s.party = $${idx}`)
      params.push(party)
      idx++
    }
    if (type) {
      conditions.push(`s.type = $${idx}`)
      params.push(type)
      idx++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = await query(
      `SELECT s.id, s.name, s.type, s.agency, s.party, s.district_id, s.fec_id,
              s.notes,
              s.created_at::TEXT as created_at,
              (SELECT COUNT(*) FROM buys b WHERE b.spender_id = s.id) as total_buys,
              (SELECT COALESCE(SUM(total_dollars), 0) FROM buys b WHERE b.spender_id = s.id) as total_spend
       FROM spenders s
       ${where}
       ORDER BY s.name
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    )

    const countResult = await query<{ total: number }>(
      `SELECT COUNT(*) as total FROM spenders s ${where}`,
      params
    )

    return NextResponse.json({
      data: rows,
      total: Number(countResult[0]?.total ?? 0),
    })
  } catch (error) {
    console.error('Spenders API error:', error)
    return NextResponse.json({ error: 'Failed to fetch spenders' }, { status: 500 })
  }
}
