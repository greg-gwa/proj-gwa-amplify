import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')

    let sql = `
      SELECT m.id::TEXT, m.dma_name, COUNT(s.id)::INTEGER as station_count
      FROM markets m
      LEFT JOIN stations s ON s.market_id = m.id
    `
    const params: unknown[] = []

    if (search) {
      sql += ` WHERE m.dma_name ILIKE $1`
      params.push(`%${search}%`)
    }

    sql += ` GROUP BY m.id, m.dma_name ORDER BY m.dma_name`

    const rows = await query(sql, params)

    return NextResponse.json({ data: rows })
  } catch (error) {
    console.error('Markets API error:', error)
    return NextResponse.json({ error: 'Failed to fetch markets' }, { status: 500 })
  }
}
