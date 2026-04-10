import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Base CTE: UNION of FCC filings (radar_items line_items) and email buys (buy_line_dayparts)
const COMBINED_CTE = `
  WITH combined AS (
    -- Source 1: FCC filings — unpack parsed_data->line_items array
    SELECT
      ri.id::TEXT || '_li_' || COALESCE(li->>'line', '0') AS id,
      ri.station_call_sign,
      ri.market_name,
      ri.spender_name,
      li->>'daypart'                              AS daypart,
      split_part(li->>'time', '-', 1)             AS time_start,
      split_part(li->>'time', '-', 2)             AS time_end,
      li->>'days'                                 AS days,
      ri.flight_start,
      ri.flight_end,
      CASE
        WHEN ri.flight_end < CURRENT_DATE   THEN 'ended'
        WHEN ri.flight_start > CURRENT_DATE THEN 'upcoming'
        ELSE 'active'
      END                                         AS status,
      0                                           AS matches_found,
      'fcc'::TEXT                                 AS source,
      ri.market_id
    FROM radar_items ri
    CROSS JOIN LATERAL jsonb_array_elements(ri.parsed_data->'line_items') AS li
    WHERE ri.parsed_data IS NOT NULL
      AND jsonb_typeof(ri.parsed_data->'line_items') = 'array'
      AND jsonb_array_length(ri.parsed_data->'line_items') > 0
      AND ri.flight_end >= CURRENT_DATE - 90

    UNION ALL

    -- Source 2: Email buys — join buy_line_dayparts for time windows
    SELECT
      bld.id::TEXT                                AS id,
      bl.station_call_sign,
      bl.market_name,
      b.spender_name,
      bld.daypart,
      bld.time_start,
      bld.time_end,
      bld.days,
      bl.flight_start,
      bl.flight_end,
      CASE
        WHEN bl.flight_end < CURRENT_DATE   THEN 'ended'
        WHEN bl.flight_start > CURRENT_DATE THEN 'upcoming'
        ELSE 'active'
      END                                         AS status,
      0                                           AS matches_found,
      'buy'::TEXT                                 AS source,
      bl.market_id
    FROM buy_lines bl
    JOIN buys b ON bl.buy_id = b.id
    JOIN buy_line_dayparts bld ON bld.buy_line_id = bl.id
    WHERE bl.flight_end >= CURRENT_DATE - 90
  )
`

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const activeOnly = searchParams.get('active') !== 'false'
    const stationFilter = searchParams.get('station')
    const marketId = searchParams.get('market_id')
    const marketIds = searchParams.get('market_ids')
      ? searchParams.get('market_ids')!.split(',').filter(Boolean)
      : []
    const spenderIds = searchParams.get('spender_ids')
      ? searchParams.get('spender_ids')!.split(',').filter(Boolean)
      : []
    const candidateId = searchParams.get('candidate_id')
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
      conditions.push(`flight_start <= CURRENT_DATE`)
      conditions.push(`flight_end >= CURRENT_DATE`)
    }

    if (stationFilter) {
      conditions.push(`station_call_sign = $${idx}`)
      params.push(stationFilter)
      idx++
    }

    if (marketId) {
      conditions.push(`market_id = $${idx}::uuid`)
      params.push(marketId)
      idx++
    }

    if (marketIds.length > 0) {
      conditions.push(`market_id = ANY($${idx}::uuid[])`)
      params.push(marketIds)
      idx++
    }

    if (spenderIds.length > 0) {
      conditions.push(`spender_name IN (SELECT name FROM spenders WHERE id = ANY($${idx}::uuid[]))`)
      params.push(spenderIds)
      idx++
    }

    if (candidateId) {
      conditions.push(`spender_name IN (
        SELECT s.name FROM spenders s
        JOIN fec_committees fc ON fc.cmte_id = s.fec_id
        WHERE fc.cand_id = $${idx}
      )`)
      params.push(candidateId)
      idx++
    }

    if (searchQ) {
      conditions.push(`(spender_name ILIKE $${idx} OR station_call_sign ILIKE $${idx})`)
      params.push(`%${searchQ}%`)
      idx++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const allowedSorts: Record<string, string> = {
      station_call_sign: 'station_call_sign',
      market_name:       'market_name',
      spender_name:      'spender_name',
      daypart:           'daypart',
      flight_start:      'flight_start',
      status:            'status',
      matches_found:     'matches_found',
      source:            'source',
    }
    const orderCol = allowedSorts[sortBy] || 'station_call_sign'

    const rows = await query(
      `${COMBINED_CTE}
       SELECT *
       FROM (
         SELECT DISTINCT ON (station_call_sign, spender_name, daypart, time_start, time_end, flight_start, flight_end)
           id, station_call_sign, market_name, spender_name, daypart,
           time_start, time_end, days,
           flight_start::TEXT, flight_end::TEXT,
           status, matches_found, source
         FROM combined
         ${where}
         ORDER BY station_call_sign, spender_name, daypart, time_start, time_end, flight_start, flight_end
       ) deduped
       ORDER BY ${orderCol} ${sortDir}
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    )

    const countRows = await query(
      `${COMBINED_CTE}
       SELECT COUNT(*) AS total
       FROM (
         SELECT DISTINCT station_call_sign, spender_name, daypart, time_start, time_end, flight_start, flight_end
         FROM combined
         ${where}
       ) deduped`,
      params
    )
    const total = parseInt((countRows[0] as any)?.total || '0', 10)

    // Stats — filtered by market/spender/candidate only (no station/search filter)
    const statsConditions: string[] = []
    const statsParams: unknown[] = []
    let sIdx = 1

    if (activeOnly) {
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

    if (spenderIds.length > 0) {
      statsConditions.push(`spender_name IN (SELECT name FROM spenders WHERE id = ANY($${sIdx}::uuid[]))`)
      statsParams.push(spenderIds)
      sIdx++
    }

    if (candidateId) {
      statsConditions.push(`spender_name IN (
        SELECT s.name FROM spenders s
        JOIN fec_committees fc ON fc.cmte_id = s.fec_id
        WHERE fc.cand_id = $${sIdx}
      )`)
      statsParams.push(candidateId)
      sIdx++
    }

    const statsWhere = statsConditions.length > 0 ? `WHERE ${statsConditions.join(' AND ')}` : ''

    const stats = await query(
      `${COMBINED_CTE}
       SELECT
         (SELECT COUNT(*) FROM (
           SELECT DISTINCT station_call_sign, spender_name, daypart, time_start, time_end, flight_start, flight_end
           FROM combined ${statsWhere}
         ) d) AS total_windows,
         COUNT(DISTINCT station_call_sign) AS stations,
         COUNT(DISTINCT spender_name)      AS spenders,
         COUNT(*) FILTER (WHERE flight_start <= CURRENT_DATE AND flight_end >= CURRENT_DATE) AS active_now
       FROM combined
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
