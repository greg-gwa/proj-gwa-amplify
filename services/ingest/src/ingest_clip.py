import json
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone

import openai
import anthropic
from src.db import get_pool

logger = logging.getLogger(__name__)

anthropic_client = anthropic.Anthropic()

AD_EXTRACT_PROMPT = """You are an ad intelligence extraction engine for Amplify, a political competitive intelligence platform.

You receive transcripts of TV/radio/podcast ad clips. Extract structured data about the political ad.

Return valid JSON:
{
  "shows": [
    {
      "title": "string (ad title or spender name)",
      "category": "political",
      "venue_name": null,
      "dates_mentioned": [],
      "prices_mentioned": [],
      "confidence": 0.85
    }
  ],
  "ad": {
    "type": "attack|contrast|positive|issue|promo|unknown",
    "media_type": "tv|radio|podcast|streaming|digital",
    "station_or_channel": "string or null",
    "program": "string or null",
    "estimated_duration_seconds": 30,
    "advertiser": "string (spender/PAC name)",
    "candidate_mentioned": "string or null",
    "call_to_action": "string or null"
  },
  "meta": {
    "is_relevant": true,
    "transcript_quality": "clear|partial|poor",
    "confidence": 0.9
  }
}"""


async def transcribe_from_url(url: str) -> dict:
    """Download clip from URL and transcribe via Whisper API."""
    import httpx

    oai = openai.OpenAI()

    with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as tmp:
        async with httpx.AsyncClient() as http:
            resp = await http.get(url, follow_redirects=True)
            resp.raise_for_status()
            tmp.write(resp.content)
            tmp_path = tmp.name

    try:
        with open(tmp_path, "rb") as f:
            result = oai.audio.transcriptions.create(
                model="whisper-1",
                file=f,
                response_format="verbose_json",
            )
        return {
            "text": result.text,
            "duration": getattr(result, "duration", None),
            "language": getattr(result, "language", None),
        }
    finally:
        os.unlink(tmp_path)


async def extract_ad_intelligence(transcript: str, **kwargs) -> dict:
    """Extract ad metadata from transcript using Claude."""
    context_parts = [f'Transcript: "{transcript}"']
    for key in ("source_url", "media_type", "station", "duration"):
        if kwargs.get(key):
            context_parts.append(f"{key}: {kwargs[key]}")

    try:
        response = anthropic_client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=2048,
            system=AD_EXTRACT_PROMPT,
            messages=[{"role": "user", "content": "\n".join(context_parts)}],
        )
        import re
        content = response.content[0].text
        match = re.search(r"```json?\s*([\s\S]*?)```", content)
        return json.loads(match.group(1).strip() if match else content)
    except Exception as e:
        logger.error(f"Ad extraction failed: {e}")
        return {"shows": [], "ad": {}, "meta": {"error": str(e), "is_relevant": False}}


async def handle_clip(body: dict) -> dict:
    """Full clip pipeline: download → transcribe → extract → store."""
    clip_id = uuid.uuid4()
    now = datetime.now(timezone.utc)

    url = body.get("url")
    if not url:
        raise ValueError("Missing required field: url")

    media_type = body.get("media_type")
    station = body.get("station")
    source_platform = body.get("source_platform")

    logger.info(f"Processing clip: {url} ({media_type or 'unknown'} / {station or 'unknown'})")

    # 1. Transcribe
    transcript = await transcribe_from_url(url)
    logger.info(f"Transcribed: {transcript.get('duration')}s, {len(transcript['text'])} chars")

    # 2. Extract
    extraction = await extract_ad_intelligence(
        transcript["text"],
        source_url=url,
        media_type=media_type,
        station=station,
        duration=transcript.get("duration"),
    )

    # 3. Store
    show_title = (extraction.get("shows") or [{}])[0].get("title") if extraction.get("shows") else None
    dates_mentioned = (extraction.get("shows") or [{}])[0].get("dates_mentioned", []) if extraction.get("shows") else []
    ad_type = extraction.get("ad", {}).get("type")
    advertiser = extraction.get("ad", {}).get("advertiser")
    is_relevant = extraction.get("meta", {}).get("is_relevant", True)
    confidence = extraction.get("meta", {}).get("confidence")

    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO ad_clips (id, source_url, source_platform, media_type,
                   station_or_channel, program, clip_duration_seconds, transcript,
                   transcript_language, show_title_extracted, ad_type, advertiser,
                   dates_mentioned, prices_mentioned, call_to_action, is_relevant,
                   confidence, extraction_json, created_at, processed_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$19)""",
            clip_id, url, source_platform,
            extraction.get("ad", {}).get("media_type", media_type),
            extraction.get("ad", {}).get("station_or_channel", station),
            extraction.get("ad", {}).get("program"),
            transcript.get("duration"),
            transcript["text"],
            transcript.get("language"),
            show_title, ad_type, advertiser,
            dates_mentioned, [],
            extraction.get("ad", {}).get("call_to_action"),
            is_relevant, confidence,
            json.dumps(extraction),
            now,
        )

    return {
        "clip_id": str(clip_id),
        "duration": transcript.get("duration"),
        "show_title": show_title,
        "is_relevant": is_relevant,
        "ad_type": ad_type,
    }
