import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

const COMMITTEE_TYPE_LABELS: Record<string, string> = {
  C: 'Communication Cost',
  D: 'Delegate',
  H: 'House',
  I: 'Independent Expenditor',
  N: 'PAC - Nonqualified',
  O: 'Super PAC',
  P: 'Presidential',
  Q: 'PAC - Qualified',
  S: 'Senate',
  U: 'Single Candidate IE',
  V: 'PAC w/ Non-Contribution - Nonqualified',
  W: 'PAC w/ Non-Contribution - Qualified',
  X: 'Party - Nonqualified',
  Y: 'Party - Qualified',
  Z: 'National Party Nonfederal',
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const name = searchParams.get('name')

    if (!name) {
      return NextResponse.json({ error: 'Missing name parameter' }, { status: 400 })
    }

    // FEC matching disabled for now — PDF parsing will provide enrichment data
    // TODO: Re-enable once we have parsed spender data to match against
    const committeeRows: Record<string, unknown>[] = []

    if (!committeeRows || committeeRows.length === 0) {
      return NextResponse.json({
        committee: null,
        candidate: null,
        stats: null,
      })
    }

    const committee = committeeRows[0] as Record<string, unknown>
    const candId = committee.cand_id as string | null

    // Get linked candidate if exists
    let candidate = null
    if (candId) {
      const candidateRows = await query(
        `SELECT cand_id, cand_name, party, party_full, office, state, district, election_year
         FROM fec_candidates
         WHERE cand_id = $1
         LIMIT 1`,
        [candId]
      )
      candidate = candidateRows[0] || null
    }

    return NextResponse.json({
      committee: {
        cmte_id: committee.cmte_id,
        cmte_name: committee.cmte_name,
        cmte_type: committee.cmte_type,
        cmte_type_label: COMMITTEE_TYPE_LABELS[committee.cmte_type as string] || committee.cmte_type,
        cmte_party: committee.cmte_party,
        connected_org: committee.connected_org,
        cand_id: committee.cand_id,
        treasurer_name: committee.treasurer_name,
        city: committee.city,
        state: committee.state,
      },
      candidate: candidate
        ? {
            cand_id: (candidate as Record<string, unknown>).cand_id,
            cand_name: (candidate as Record<string, unknown>).cand_name,
            party: (candidate as Record<string, unknown>).party,
            party_full: (candidate as Record<string, unknown>).party_full,
            office: (candidate as Record<string, unknown>).office,
            state: (candidate as Record<string, unknown>).state,
            district: (candidate as Record<string, unknown>).district,
            election_year: (candidate as Record<string, unknown>).election_year,
          }
        : null,
      stats: {
        total_raised: 0,
        total_spent: 0,
        top_donors: [],
        recent_expenditures: [],
      },
    })
  } catch (error) {
    console.error('FEC API error:', error)
    return NextResponse.json({ error: 'Failed to fetch FEC data' }, { status: 500 })
  }
}
