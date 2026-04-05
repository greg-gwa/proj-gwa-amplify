import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SCHEMA = `
-- Core FCC Filing Data
radar_items: id, fcc_filing_id, station_call_sign, market_name, spender_name, spender_type, flight_start (date), flight_end (date), total_dollars (numeric), filing_url, filing_storage_path, status, matched_buy_id, notes, detected_at (timestamptz), created_at, updated_at

-- Email-ingested Buy Data
buys: id, estimate_number, spender_id (fk→spenders), spender_name, agency, flight_start, flight_end, spot_length_seconds, total_dollars, status, is_revision, source_email_id, extraction_confidence, created_at
buy_lines: id, buy_id (fk→buys), station_call_sign, market_name, network, spot_length_seconds, total_dollars, flight_start, flight_end, source_contact_name/email/phone
buy_line_weeks: id, buy_line_id (fk→buy_lines), week_start, week_end, dollars, spots

-- Reference Data
spenders: id, name, type, agency, party, district_id, fec_id, notes
stations: id, call_sign, network, market_name, owner, media_type
markets: id, name, dma_code, dma_rank, state
contacts: id, name, title, company, email, phone, stations[]
fec_committees: cmte_id (pk), cmte_name, cmte_type (H=House,S=Senate,P=Presidential,O=SuperPAC,Q=PAC,N=PAC,X/Y=Party), cmte_party, connected_org, cand_id, treasurer_name, city, state
fec_candidates: cand_id (pk), cand_name, party, party_full, office (H=House,S=Senate,P=President), state, district, election_year

-- Creative Data
creatives: id, spender_id, title, ad_type, transcript, clip_url, sentiment, keywords[], themes[]
ad_clips: id, source_url, station_or_channel, transcript, advertiser, ad_type, confidence

-- Operational
raw_emails: id, received_at, from_address, to_address, subject, attachment_count, processed
radar_scans: id, started_at, completed_at, stations_scanned, filings_found, new_items, matched_items, errors
radar_config: id, key (unique), value (jsonb)
`

const SYSTEM_PROMPT = `You are an AI analyst for Amplify, a political ad spend intelligence platform. Answer questions by writing SQL against the Amplify database. Always show your reasoning. Format dollar amounts nicely. When results are returned, summarize them conversationally.

Here is the complete database schema:
${SCHEMA}

SQL tips:
- Text matching: use ILIKE for case-insensitive
- Dollar amounts are NUMERIC(14,2)
- Dates: flight_start/flight_end are DATE, detected_at/created_at are TIMESTAMPTZ
- Market names are like 'WASHINGTON, DC' or 'ATLANTA, GA'
- station_call_sign includes suffix like 'WJLA-TV', 'WTTG'
- FEC matching: UPPER(fec_committees.cmte_name) LIKE '%' || UPPER(radar_items.spender_name) || '%'
- Always LIMIT results (max 100)
- radar_items is the main table with the most data right now

Use the run_sql tool to execute queries. You can call it multiple times if needed to refine your analysis.`

const RUN_SQL_TOOL: Anthropic.Tool = {
  name: 'run_sql',
  description: 'Execute a read-only SQL query against the Amplify Postgres database and return the results as JSON rows. Always include LIMIT (max 100).',
  input_schema: {
    type: 'object' as const,
    properties: {
      sql: {
        type: 'string',
        description: 'The SQL query to execute',
      },
    },
    required: ['sql'],
  },
}

async function executeSql(sql: string): Promise<{ rows?: Record<string, unknown>[]; error?: string }> {
  try {
    // Enforce LIMIT 100 if not present
    const upperSql = sql.toUpperCase()
    let finalSql = sql
    if (!upperSql.includes('LIMIT')) {
      finalSql = sql.replace(/;?\s*$/, ' LIMIT 100')
    }
    const rows = await query(finalSql)
    return { rows }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return { error: msg }
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    // Accept either simple messages or full Anthropic message params (with tool use history)
    const incomingMessages: Anthropic.MessageParam[] = body.history || []
    const userText: string | undefined = body.userMessage

    if (!userText && incomingMessages.length === 0) {
      return NextResponse.json({ error: 'userMessage is required' }, { status: 400 })
    }

    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY not configured' }, { status: 500 })
    }

    const client = new Anthropic({ apiKey })

    // Build message list: prior history + new user message
    const currentMessages: Anthropic.MessageParam[] = [...incomingMessages]
    if (userText) {
      currentMessages.push({ role: 'user', content: userText })
    }

    // Tool use loop
    const maxIterations = 10

    for (let i = 0; i < maxIterations; i++) {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [RUN_SQL_TOOL],
        messages: currentMessages,
      })

      // Check if Claude wants to use a tool
      if (response.stop_reason === 'tool_use') {
        // Collect text + tool_use blocks as assistant turn
        const assistantContent: Anthropic.ContentBlockParam[] = []
        for (const block of response.content) {
          if (block.type === 'text') {
            assistantContent.push({ type: 'text' as const, text: block.text })
          } else if (block.type === 'tool_use') {
            assistantContent.push({
              type: 'tool_use' as const,
              id: block.id,
              name: block.name,
              input: block.input,
            })
          }
        }

        currentMessages.push({ role: 'assistant', content: assistantContent })

        // Execute each tool call and build results
        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const input = block.input as { sql: string }
            const result = await executeSql(input.sql)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result),
            })
          }
        }

        currentMessages.push({ role: 'user', content: toolResults })
      } else {
        // Final response — extract text
        const textParts = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
        const finalText = textParts.join('\n\n')

        // Add final assistant message to history
        currentMessages.push({ role: 'assistant', content: finalText })

        // Return response + full conversation history for next turn
        return NextResponse.json({
          response: finalText,
          history: currentMessages,
        })
      }
    }

    return NextResponse.json({ response: 'I ran too many queries trying to answer that. Could you simplify your question?' })
  } catch (e: unknown) {
    console.error('Ask API error:', e)
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
