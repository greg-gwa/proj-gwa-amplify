import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('active') !== 'false'
    const stationFilter = searchParams.get('station')
    const marketId = searchParams.get('market_id')
    const marketIds = searchParams.get('market_ids')
      ? searchParams.get('market_ids')!.split(',').filter(Boolean)
      : []
    const searchQ = searchParams.get('search')
    const sortBy = searchParams.get('sort') || 'station_call_sign'
    const sortDir = searchParams.get('dir') === 'desc' ? 'DESC' : 'ASC'
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)))
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (activeOnly) {
      conditions.push(`m.status = 'active'`)
      conditions.push(`m.flight_start <= CURRENT_DATE`)
      conditions.push(`m.flight_end >= CURRENT_DATE`)
    }

    if (stationFilter) {
      conditions.push(`m.station_call_sign = $${idx}`)
      params.push(stationFilter)
      idx++
    }

    // Single market_id (legacy)
    if (marketId) {
      conditions.push(`m.market_id = $${idx}::uuid`)
      params.push(marketId)
      idx++
    }

    // Multiple market_ids (new)
    if (marketIds.length > 0) {
      conditions.push(`m.market_id = ANY($${idx}::uuid[])`)
      params.push(marketIds)
      idx++
    }

    // Search by spender or station
    if (searchQ) {
      conditions.push(`(m.spender_name ILIKE $${idx} OR m.station_call_sign ILIKE $${idx})`)
      params.push(`%${searchQ}%`)
      idx++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Allowed sort columns
    const allowedSorts: Record<string, string> = {
      station_call_sign: 'm.station_call_sign',
      market_name: 'mk.dma_name',
      spender_name: 'm.spender_name',
      daypart: 'm.daypart',
      flight_start: 'm.flight_start',
      status: 'm.status',
      matches_found: 'matches_found',
    }
    const orderCol = allowedSorts[sortBy] || 'm.station_call_sign'

    // Use DISTINCT ON to deduplicate monitors with same station/spender/daypart/time/flight
    const rows = await query(
      `SELECT DISTINCT ON (m.station_call_sign, m.spender_name, m.daypart, m.time_start, m.time_end, m.flight_start, m.flight_end)
              m.id, m.station_call_sign, m.spender_name, m.daypart,
              m.time_start, m.time_end, m.days, m.spot_length,
              m.flight_start::TEXT, m.flight_end::TEXT, m.status,
              mk.dma_name as market_name,
              (SELECT COUNT(*) FROM creative_matches cm WHERE cm.monitor_id = m.id)::INTEGER as matches_found
       FROM monitors m
       LEFT JOIN markets mk ON m.market_id = mk.id
       ${where}
       ORDER BY m.station_call_sign, m.spender_name, m.daypart, m.time_start, m.time_end, m.flight_start, m.flight_end, m.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    )

    // Count for pagination (deduplicated)
    const countRows = await query(
      `SELECT COUNT(*) as total FROM (
        SELECT DISTINCT station_call_sign, spender_name, daypart, time_start, time_end, flight_start, flight_end
        FROM monitors m LEFT JOIN markets mk ON m.market_id = mk.id ${where}
       ) deduped`,
      params
    )
    const total = parseInt((countRows[0] as any)?.total || '0', 10)

    // Summary stats (filtered by same market_ids)
    const statsConditions: string[] = []
    const statsParams: unknown[] = []
    let sIdx = 1

    if (activeOnly) {
      statsConditions.push(`status = 'active'`)
      statsConditions.push(`flight_start <= CURRENT_DATE`)
      statsConditions.push(`flight_end >= CURRENT_DATE`)
    }

    if (marketIds.length > 0) {
      statsConditions.push(`market_id = ANY($${sIdx}::uuid[])`)
      statsParams.push(marketIds)
      sIdx++
    } else if (marketId) {
      statsConditions.push(`market_id = $${sIdx}::uuid`)
      statsParams.push(marketId)
      sIdx++
    }

    const statsWhere = statsConditions.length > 0 ? `WHERE ${statsConditions.join(' AND ')}` : ''

    const stats = await query(
      `SELECT
        (SELECT COUNT(*) FROM (
          SELECT DISTINCT station_call_sign, spender_name, daypart, time_start, time_end, flight_start, flight_end
          FROM monitors ${statsWhere}
        ) d) as total_windows,
        COUNT(DISTINCT station_call_sign) as stations,
        COUNT(DISTINCT spender_name) as spenders,
        COUNT(*) FILTER (WHERE status = 'active' AND flight_start <= CURRENT_DATE AND flight_end >= CURRENT_DATE) as active_now
       FROM monitors
       ${statsWhere}`,
      statsParams
    )

    return NextResponse.json({
      data: rows,
      stats: stats[0] || {},
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error) {
    console.error('Monitors API error:', error)
    return NextResponse.json({ error: 'Failed to fetch monitors' }, { status: 500 })
  }
}
