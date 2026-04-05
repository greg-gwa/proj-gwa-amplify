import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const INGEST_URL = process.env.INGEST_URL || 'https://amplify-ingest-910892119253.us-central1.run.app'

export async function POST() {
  try {
    // Fire-and-forget: send the request but don't await the response.
    // The scan takes ~25 min; we just need to confirm it started.
    // Cloud Run will keep running even after we disconnect.
    fetch(`${INGEST_URL}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lookback_hours: 6 }),
    }).catch(() => {
      // Swallow — scan runs server-side regardless
    })

    return NextResponse.json({ ok: true, message: 'Scan triggered — check log for progress' })
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
