import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')
    const spender = searchParams.get('spender')
    const status = searchParams.get('status')
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')

    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (spender) {
      conditions.push(`LOWER(spender_name) LIKE LOWER($${idx})`)
      params.push(`%${spender}%`)
      idx++
    }
    if (status) {
      conditions.push(`status = $${idx}`)
      params.push(status)
      idx++
    }
    if (dateFrom) {
      conditions.push(`created_at::DATE >= $${idx}`)
      params.push(dateFrom)
      idx++
    }
    if (dateTo) {
      conditions.push(`created_at::DATE <= $${idx}`)
      params.push(dateTo)
      idx++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = await query(
      `SELECT b.id, b.estimate_number, b.spender_name, b.agency,
              b.flight_start::TEXT as flight_start,
              b.flight_end::TEXT as flight_end,
              b.total_dollars, b.extraction_confidence, b.status,
              b.created_at::TEXT as created_at,
              (SELECT COUNT(*) FROM buy_lines bl WHERE bl.buy_id = b.id) as stations_count,
              (SELECT r.filing_url FROM radar_items r
               WHERE r.matched_buy_id = b.id AND r.filing_url IS NOT NULL
                 AND r.document_type IN ('CONTRACT', 'ORDER')
               ORDER BY r.total_dollars DESC NULLS LAST
               LIMIT 1) as fcc_filing_url,
              (SELECT COUNT(*) FROM radar_items r
               WHERE r.matched_buy_id = b.id
                 AND r.document_type IN ('CONTRACT', 'ORDER')) as fcc_match_count
       FROM buys b
       ${where}
       ORDER BY b.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    )

    const countResult = await query<{ total: number }>(
      `SELECT COUNT(*) as total FROM buys b ${where}`,
      params
    )

    return NextResponse.json({
      data: rows,
      total: Number(countResult[0]?.total ?? 0),
    })
  } catch (error) {
    console.error('Buys API error:', error)
    return NextResponse.json({ error: 'Failed to fetch buys' }, { status: 500 })
  }
}
