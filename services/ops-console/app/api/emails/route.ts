import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')
    const dateFrom = searchParams.get('date_from')
    const dateTo = searchParams.get('date_to')
    const status = searchParams.get('status')

    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (dateFrom) {
      conditions.push(`received_at::DATE >= $${idx}`)
      params.push(dateFrom)
      idx++
    }
    if (dateTo) {
      conditions.push(`received_at::DATE <= $${idx}`)
      params.push(dateTo)
      idx++
    }
    if (status === 'processed') conditions.push(`processed = true`)
    if (status === 'pending') conditions.push(`processed = false`)

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = await query(
      `SELECT id, subject, from_address, to_address,
              received_at::TEXT as received_at,
              processed, attachment_count,
              processed_at::TEXT as processed_at
       FROM raw_emails
       ${where}
       ORDER BY received_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    )

    const countResult = await query<{ total: number }>(
      `SELECT COUNT(*) as total FROM raw_emails ${where}`,
      params
    )

    return NextResponse.json({
      data: rows,
      total: Number(countResult[0]?.total ?? 0),
    })
  } catch (error) {
    console.error('Emails API error:', error)
    return NextResponse.json({ error: 'Failed to fetch emails' }, { status: 500 })
  }
}
