import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')
    const status = searchParams.get('status')
    const station = searchParams.get('station')
    const detectionMethod = searchParams.get('detection_method')

    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (station) {
      conditions.push(`LOWER(ac.station_or_channel) LIKE LOWER($${idx})`)
      params.push(`%${station}%`)
      idx++
    }
    if (status === 'relevant') {
      conditions.push(`ac.is_relevant = true`)
    } else if (status === 'not_relevant') {
      conditions.push(`ac.is_relevant = false`)
    }
    if (detectionMethod) {
      conditions.push(`ac.detection_method = $${idx}`)
      params.push(detectionMethod)
      idx++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Group by creative — show one card per unique ad with airing details
    const rows = await query(
      `SELECT DISTINCT ON (COALESCE(ac.creative_id, ac.id))
              ac.id, ac.source_url, ac.source_platform,
              ac.station_or_channel, ac.clip_duration_seconds as duration_seconds,
              ac.ad_type, ac.advertiser, ac.confidence, ac.is_relevant,
              ac.transcript as transcript,
              ac.detection_method,
              COALESCE(c.storage_path, ac.video_storage_path) as video_storage_path,
              ac.thumbnail_storage_path,
              ac.air_date::TEXT as air_date, ac.air_time,
              ac.matched_spender_name,
              ac.creative_id::TEXT as creative_id,
              ac.radar_item_id::TEXT as radar_item_id,
              COALESCE(c.airing_count, 1) as airing_count,
              c.title as creative_title,
              c.station_first_seen as creative_first_station,
              c.date_first_aired::TEXT as creative_first_aired,
              ac.created_at::TEXT as created_at
       FROM ad_clips ac
       LEFT JOIN creatives c ON c.id = ac.creative_id
       ${where}
       ORDER BY COALESCE(ac.creative_id, ac.id), ac.created_at ASC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    )

    const countResult = await query<{ total: number }>(
      `SELECT COUNT(DISTINCT COALESCE(ac.creative_id, ac.id)) as total FROM ad_clips ac ${where}`,
      params
    )

    return NextResponse.json({
      data: rows,
      total: Number(countResult[0]?.total ?? 0),
    })
  } catch (error) {
    console.error('Clips API error:', error)
    return NextResponse.json({ error: 'Failed to fetch clips' }, { status: 500 })
  }
}
