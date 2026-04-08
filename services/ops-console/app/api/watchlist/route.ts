import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const rows = await query<{ value: Record<string, unknown> }>(
      `SELECT value FROM radar_config WHERE key = $1`,
      ['watch_config']
    )

    const config = rows[0]?.value ?? { market_ids: [], scan_interval_hours: 4, lookback_hours: 6 }
    const marketIds = (config.market_ids as string[]) || []

    // Resolve market IDs to names + station counts for display
    let markets: Array<{ id: string; dma_name: string; station_count: number }> = []
    if (marketIds.length > 0) {
      markets = await query(
        `SELECT m.id::TEXT, m.dma_name, COUNT(s.id)::INTEGER as station_count
         FROM markets m
         LEFT JOIN stations s ON s.market_id = m.id
         WHERE m.id = ANY($1::uuid[])
         GROUP BY m.id, m.dma_name
         ORDER BY m.dma_name`,
        [marketIds]
      )
    }

    return NextResponse.json({
      data: {
        ...config,
        markets,  // resolved for display
      },
    })
  } catch (error) {
    console.error('Watchlist GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action } = body

    // Load current config
    const rows = await query<{ value: Record<string, unknown> }>(
      `SELECT value FROM radar_config WHERE key = $1`,
      ['watch_config']
    )
    const config: Record<string, unknown> = rows[0]?.value ?? {
      market_ids: [],
      scan_interval_hours: 4,
      lookback_hours: 6,
    }

    const marketIds = (config.market_ids as string[]) || []

    if (action === 'add_market') {
      const marketId = body.market_id as string
      if (!marketId) {
        return NextResponse.json({ error: 'Missing market_id' }, { status: 400 })
      }
      if (!marketIds.includes(marketId)) {
        marketIds.push(marketId)
        config.market_ids = marketIds
      }
    } else if (action === 'remove_market') {
      const marketId = body.market_id as string
      if (!marketId) {
        return NextResponse.json({ error: 'Missing market_id' }, { status: 400 })
      }
      config.market_ids = marketIds.filter((id: string) => id !== marketId)
    } else if (action === 'update') {
      Object.assign(config, body.config)
    } else {
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    // Upsert config
    await query(
      `INSERT INTO radar_config (id, key, value, updated_at)
       VALUES (gen_random_uuid(), $1, $2::jsonb, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = NOW()`,
      ['watch_config', JSON.stringify(config)]
    )

    return NextResponse.json({ ok: true, data: config })
  } catch (error) {
    console.error('Watchlist POST error:', error)
    return NextResponse.json({ error: 'Failed to update watchlist' }, { status: 500 })
  }
}
