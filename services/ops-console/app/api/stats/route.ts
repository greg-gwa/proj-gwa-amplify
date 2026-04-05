import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

const TZ = 'America/New_York'

export async function GET() {
  try {
    const [emailsToday, buysToday, clipsToday, reviewCount, weeklySpend] = await Promise.all([
      query<{ count: number }>(
        `SELECT COUNT(*) as count FROM raw_emails
         WHERE (received_at AT TIME ZONE '${TZ}')::DATE = (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::DATE`
      ),
      query<{ count: number }>(
        `SELECT COUNT(*) as count FROM buys
         WHERE (created_at AT TIME ZONE '${TZ}')::DATE = (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::DATE`
      ),
      query<{ count: number }>(
        `SELECT COUNT(*) as count FROM ad_clips
         WHERE (created_at AT TIME ZONE '${TZ}')::DATE = (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::DATE`
      ),
      query<{ count: number }>(
        `SELECT COUNT(*) as count FROM buys
         WHERE status IN ('pending', 'review', 'low_confidence')
           OR extraction_confidence < 0.7`
      ),
      query<{ total: number }>(
        `SELECT COALESCE(SUM(total_dollars), 0) as total FROM buys
         WHERE (created_at AT TIME ZONE '${TZ}')::DATE >= (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::DATE - INTERVAL '7 days'`
      ),
    ])

    const recentActivity = await query(
      `SELECT 'buy' as type, id, created_at::TEXT as timestamp,
              'New buy: ' || COALESCE(spender_name, 'Unknown') || ' - $' || TO_CHAR(COALESCE(total_dollars, 0), 'FM999,999,999.00') as summary
       FROM buys
       WHERE created_at >= NOW() - INTERVAL '24 hours'
       UNION ALL
       SELECT 'clip' as type, id, created_at::TEXT as timestamp,
              'New clip: ' || COALESCE(advertiser, 'Unknown') || ' on ' || COALESCE(station_or_channel, 'Unknown') as summary
       FROM ad_clips
       WHERE created_at >= NOW() - INTERVAL '24 hours'
       ORDER BY timestamp DESC
       LIMIT 20`
    )

    return NextResponse.json({
      emails_today: Number(emailsToday[0]?.count ?? 0),
      buys_today: Number(buysToday[0]?.count ?? 0),
      clips_today: Number(clipsToday[0]?.count ?? 0),
      review_queue_count: Number(reviewCount[0]?.count ?? 0),
      weekly_spend: Number(weeklySpend[0]?.total ?? 0),
      recent_activity: recentActivity,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error('Stats API error:', msg, error)
    return NextResponse.json({ error: 'Failed to fetch stats', detail: msg }, { status: 500 })
  }
}
