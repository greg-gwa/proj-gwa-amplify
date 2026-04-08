import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    const [buyRows, linesRows, creativesRows] = await Promise.all([
      query(
        `SELECT b.*, b.created_at::TEXT as created_at_str,
                b.flight_start::TEXT as flight_start_str,
                b.flight_end::TEXT as flight_end_str,
                e.subject as email_subject, e.from_address as email_sender
         FROM buys b
         LEFT JOIN raw_emails e ON b.source_email_id = e.id
         WHERE b.id = $1`,
        [id]
      ),
      query(
        `SELECT bl.id, bl.buy_id,
                bl.station_call_sign as station_call_letters,
                bl.station_call_sign as station_name,
                bl.market_name as station_market,
                bl.network,
                bl.spot_length_seconds as spot_length,
                bl.total_dollars as total_spend,
                bl.flight_start::TEXT as flight_start,
                bl.flight_end::TEXT as flight_end,
                bl.source_contact_name, bl.source_contact_email
         FROM buy_lines bl
         WHERE bl.buy_id = $1
         ORDER BY bl.station_call_sign`,
        [id]
      ),
      query(
        `SELECT c.id, c.title, c.ad_type, c.spot_length_seconds, c.transcript,
                ca.traffic_pct
         FROM creative_assignments ca
         JOIN creatives c ON ca.creative_id = c.id
         JOIN buy_lines bl ON ca.buy_line_id = bl.id
         WHERE bl.buy_id = $1`,
        [id]
      ),
    ])

    // Fetch weeks for each line
    const lineIds = linesRows.map((l: any) => l.id)
    let weeks: any[] = []
    if (lineIds.length > 0) {
      weeks = await query(
        `SELECT blw.id, blw.buy_line_id, blw.week_start::TEXT as week_start,
                blw.week_end::TEXT as week_end, blw.dollars as spend, blw.spots
         FROM buy_line_weeks blw
         WHERE blw.buy_line_id = ANY($1)
         ORDER BY blw.week_start`,
        [lineIds]
      )
    }

    // Attach weeks to lines
    const linesWithWeeks = linesRows.map((line: any) => ({
      ...line,
      weeks: weeks.filter((w: any) => w.buy_line_id === line.id),
    }))

    if (buyRows.length === 0) {
      return NextResponse.json({ error: 'Buy not found' }, { status: 404 })
    }

    // Fetch matched FCC filings
    const matchedFilings = await query(
      `SELECT id, fcc_filing_id, station_call_sign, market_name, spender_name,
              total_dollars, flight_start::TEXT as flight_start, flight_end::TEXT as flight_end,
              filing_url, status, detected_at::TEXT as detected_at
       FROM radar_items
       WHERE matched_buy_id = $1
       ORDER BY detected_at DESC`,
      [id]
    )

    return NextResponse.json({
      buy: buyRows[0],
      lines: linesWithWeeks,
      creatives: creativesRows,
      matched_filings: matchedFilings,
    })
  } catch (error) {
    console.error('Buy detail API error:', error)
    return NextResponse.json({ error: 'Failed to fetch buy detail' }, { status: 500 })
  }
}
