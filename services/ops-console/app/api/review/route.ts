import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const filterType = searchParams.get('type')

    const queries: Promise<any[]>[] = []

    // Low confidence buys
    if (!filterType || filterType === 'low_confidence') {
      queries.push(query(
        `SELECT b.id, b.spender_name as name, 'low_confidence' as review_type,
                'high' as priority,
                'Low confidence buy: ' || COALESCE(b.spender_name, 'Unknown')
                  || ' - $' || COALESCE(b.total_dollars, 0)::TEXT
                  || ' (' || ROUND(COALESCE(b.extraction_confidence, 0) * 100)::TEXT || '%)' as summary,
                b.created_at::TEXT as created_at
         FROM buys b
         WHERE b.extraction_confidence < 0.7
         ORDER BY b.extraction_confidence ASC
         LIMIT $1`,
        [limit]
      ))
    }

    // Revisions
    if (!filterType || filterType === 'revision') {
      queries.push(query(
        `SELECT b.id, b.spender_name as name, 'revision' as review_type,
                'medium' as priority,
                'Buy revision: ' || COALESCE(b.spender_name, 'Unknown')
                  || ' - Est #' || COALESCE(b.estimate_number, 'N/A') as summary,
                b.created_at::TEXT as created_at
         FROM buys b
         WHERE b.is_revision = true AND b.status = 'pending'
         ORDER BY b.created_at DESC
         LIMIT $1`,
        [limit]
      ))
    }

    // Unmatched clips
    if (!filterType || filterType === 'unmatched_clip') {
      queries.push(query(
        `SELECT ac.id, ac.advertiser as name, 'unmatched_clip' as review_type,
                'medium' as priority,
                'Unmatched clip: ' || COALESCE(ac.advertiser, 'Unknown')
                  || ' on ' || COALESCE(ac.station_or_channel, 'Unknown') as summary,
                ac.created_at::TEXT as created_at
         FROM ad_clips ac
         WHERE ac.is_relevant = true
           AND ac.id NOT IN (SELECT source_clip_id FROM creatives WHERE source_clip_id IS NOT NULL)
         ORDER BY ac.created_at DESC
         LIMIT $1`,
        [limit]
      ))
    }

    // Missing creatives (active buys with no creative assignment)
    if (!filterType || filterType === 'missing_creative') {
      queries.push(query(
        `SELECT b.id, b.spender_name as name, 'missing_creative' as review_type,
                'low' as priority,
                'Missing creative for: ' || COALESCE(b.spender_name, 'Unknown')
                  || ' (' || b.flight_start::TEXT || ' to ' || b.flight_end::TEXT || ')' as summary,
                b.created_at::TEXT as created_at
         FROM buys b
         WHERE b.flight_end >= CURRENT_DATE
           AND NOT EXISTS (
             SELECT 1 FROM buy_lines bl
             JOIN creative_assignments ca ON ca.buy_line_id = bl.id
             WHERE bl.buy_id = b.id
           )
         ORDER BY b.flight_start ASC
         LIMIT $1`,
        [limit]
      ))
    }

    const results = await Promise.all(queries)
    const allItems = results.flat()

    // Sort: high > medium > low, then by created_at desc
    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 }
    allItems.sort((a, b) => {
      const pDiff = (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3)
      if (pDiff !== 0) return pDiff
      return (b.created_at || '').localeCompare(a.created_at || '')
    })

    return NextResponse.json({
      data: allItems.slice(0, limit),
      total: allItems.length,
    })
  } catch (error) {
    console.error('Review API error:', error)
    return NextResponse.json({ error: 'Failed to fetch review queue' }, { status: 500 })
  }
}
