import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const page = Math.max(parseInt(searchParams.get('page') || '1'), 1)
    const offset = (page - 1) * limit
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const time = searchParams.get('time')
    const sortBy = searchParams.get('sort') || 'created_at'
    const sortDir = searchParams.get('dir') === 'asc' ? 'ASC' : 'DESC'

    // Whitelist sortable columns to prevent SQL injection
    const sortableColumns: Record<string, string> = {
      spender_name: 'r.spender_name',
      station_call_sign: 'r.station_call_sign',
      market_name: 'r.market_name',
      total_dollars: 'r.total_dollars',
      detected_at: 'r.detected_at',
      created_at: 'r.created_at',
      status: 'r.status',
      flight_start: 'r.flight_start',
    }
    const orderCol = sortableColumns[sortBy] || 'r.created_at'

    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (status) {
      conditions.push(`r.status = $${idx}`)
      params.push(status)
      idx++
    }

    if (search) {
      conditions.push(`(r.spender_name ILIKE $${idx} OR r.station_call_sign ILIKE $${idx} OR r.market_name ILIKE $${idx})`)
      params.push(`%${search}%`)
      idx++
    }

    if (time) {
      const intervals: Record<string, string> = { '48h': '48 hours', '7d': '7 days', '30d': '30 days', '90d': '90 days' }
      const interval = intervals[time]
      if (interval) {
        conditions.push(`r.detected_at >= NOW() - INTERVAL '${interval}'`)
      }
    }

    const docType = searchParams.get('doc_type')
    if (docType) {
      if (docType === 'UNCLASSIFIED') {
        conditions.push(`r.document_type IS NULL`)
      } else {
        conditions.push(`r.document_type = $${idx}`)
        params.push(docType)
        idx++
      }
    }

    const marketIds = searchParams.get('market_ids')
    if (marketIds) {
      const ids = marketIds.split(',').filter(Boolean)
      if (ids.length > 0) {
        conditions.push(`r.market_id = ANY($${idx}::uuid[])`)
        params.push(ids)
        idx++
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const [rows, countResult] = await Promise.all([
      query(
        `SELECT r.id, r.spender_name, r.station_call_sign,
                COALESCE(m.dma_name, r.market_name) as market_name,
                r.flight_start::TEXT as flight_start,
                r.flight_end::TEXT as flight_end,
                r.total_dollars, r.status, r.filing_url, r.fcc_filing_id,
                r.matched_buy_id, r.document_type,
                r.detected_at::TEXT as detected_at,
                r.created_at::TEXT as created_at
         FROM radar_items r
         LEFT JOIN markets m ON r.market_id = m.id
         ${where}
         ORDER BY ${orderCol} ${sortDir} NULLS LAST
         LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]
      ),
      query<{ count: number }>(
        `SELECT COUNT(*) as count FROM radar_items r ${where}`,
        params
      ),
    ])

    const total = Number(countResult[0]?.count ?? 0)

    return NextResponse.json({
      data: rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    })
  } catch (error) {
    console.error('Radar API error:', error)
    return NextResponse.json({ error: 'Failed to fetch radar items' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, id } = body

    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id or action' }, { status: 400 })
    }

    if (action === 'dismiss') {
      const notes = body.notes || null
      await query(
        `UPDATE radar_items SET status = $1, notes = $2, updated_at = NOW() WHERE id = $3`,
        ['dismissed', notes, id]
      )
      return NextResponse.json({ ok: true, action: 'dismissed', id })
    }

    if (action === 'monitor') {
      // Create monitoring windows from this contract's parsed line items
      const item = await query(
        `SELECT r.id, r.station_call_sign, r.spender_name, r.flight_start, r.flight_end,
                r.station_id, r.market_id, r.parsed_data, r.document_type
         FROM radar_items r WHERE r.id = $1`,
        [id]
      )
      if (!item[0]) {
        return NextResponse.json({ error: 'Filing not found' }, { status: 404 })
      }
      const filing = item[0] as Record<string, unknown>
      if (filing.document_type !== 'CONTRACT' && filing.document_type !== 'ORDER') {
        return NextResponse.json({ error: 'Only contracts can be monitored' }, { status: 400 })
      }
      const parsedData = filing.parsed_data as Record<string, unknown> | null
      const lineItems = (parsedData?.line_items as Array<Record<string, unknown>>) || []
      if (lineItems.length === 0) {
        return NextResponse.json({ error: 'No line items to monitor' }, { status: 400 })
      }

      // Check if already monitored
      const existing = await query(`SELECT COUNT(*) as count FROM monitors WHERE radar_item_id = $1`, [id])
      if (Number((existing[0] as Record<string, unknown>).count) > 0) {
        return NextResponse.json({ ok: true, action: 'already_monitored', id })
      }

      let created = 0
      for (const li of lineItems) {
        const timeStr = (li.time as string) || ''
        const daypart = (li.daypart as string) || ''
        // Simple time parse — extract start/end
        const timeMatch = timeStr.match(/(\d+[ap]?\d*)\s*-\s*(\d+[ap]?\d*)/i) ||
                          daypart.match(/(\d+[ap]?\d*)\s*-\s*(\d+[ap]?\d*)/i)
        if (!timeMatch) continue

        await query(
          `INSERT INTO monitors (id, radar_item_id, station_call_sign, station_id, market_id,
             spender_name, daypart, time_start, time_end, days,
             flight_start, flight_end, spot_length, status)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'active')`,
          [id, filing.station_call_sign, filing.station_id, filing.market_id,
           filing.spender_name, daypart, timeMatch[1], timeMatch[2],
           (li.days as string) || 'MTWTF',
           filing.flight_start, filing.flight_end,
           (li.length as number) || 30]
        )
        created++
      }

      // Mark the filing as monitored
      await query(`UPDATE radar_items SET monitored = TRUE, updated_at = NOW() WHERE id = $1`, [id])

      return NextResponse.json({ ok: true, action: 'monitored', id, monitors_created: created })
    }

    if (action === 'link') {
      const buyId = body.buy_id
      if (!buyId) {
        return NextResponse.json({ error: 'Missing buy_id for link action' }, { status: 400 })
      }
      await query(
        `UPDATE radar_items SET status = $1, matched_buy_id = $2, updated_at = NOW() WHERE id = $3`,
        ['matched_to_buy', buyId, id]
      )
      return NextResponse.json({ ok: true, action: 'linked', id, buy_id: buyId })
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  } catch (error) {
    console.error('Radar POST error:', error)
    return NextResponse.json({ error: 'Failed to update radar item' }, { status: 500 })
  }
}
