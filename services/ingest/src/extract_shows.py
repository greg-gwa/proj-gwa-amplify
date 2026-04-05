import json
import logging
import uuid
from datetime import datetime, timezone

import anthropic
from src.db import get_pool

logger = logging.getLogger(__name__)

client = anthropic.Anthropic()

SYSTEM_PROMPT = """You are a structured data extraction engine for Amplify, a performing arts / entertainment aggregation platform.

You receive the contents of emails sent by venues, promoters, and arts organizations. Your job is to extract every show/event mentioned into structured JSON.

Rules:
- Extract ALL shows mentioned, even if the email contains dozens
- Parse dates carefully — handle ranges ("Apr 12-20"), individual dates, and recurring schedules
- Categorize: musical, play, comedy, concert, dance, opera, family, special_event, other
- Extract all price tiers (orchestra, mezzanine, group, student, etc.)
- If group rates mentioned, capture min_group_size and contact info
- Extract venue details if mentioned
- Set confidence 0.0-1.0 based on clarity
- Do NOT hallucinate — omit fields not mentioned

Return valid JSON:
{
  "shows": [
    {
      "title": "string",
      "category": "musical|play|comedy|concert|dance|opera|family|special_event|other",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD or null",
      "show_times": ["Fri 8pm", "Sat 2pm, 8pm"],
      "description": "brief description",
      "confidence": 0.95,
      "venue": { "name": "string", "address": "string", "city": "string", "state": "string", "zip": "string" },
      "prices": [
        { "tier": "string", "amount_min": 89.0, "amount_max": 189.0, "currency": "USD", "min_group_size": null, "contact_email": null }
      ]
    }
  ]
}"""


def strip_html(html: str) -> str:
    import re
    text = re.sub(r"<style[^>]*>[\s\S]*?</style>", "", html, flags=re.IGNORECASE)
    text = re.sub(r"<script[^>]*>[\s\S]*?</script>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


async def extract_shows(sender: str, subject: str, text: str, html: str, files: list) -> dict:
    email_content = f"From: {sender}\nSubject: {subject}\n\n{text or strip_html(html) or '[no body]'}"

    try:
        response = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=4096,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": f"Extract all shows/events from this email:\n\n{email_content}"}],
        )
        content = response.content[0].text

        # Parse JSON
        import re
        match = re.search(r"```json?\s*([\s\S]*?)```", content)
        parsed = json.loads(match.group(1).strip() if match else content)

    except Exception as e:
        logger.error(f"LLM extraction failed: {e}")
        return {"show_count": 0}

    now = datetime.now(timezone.utc)
    show_count = 0
    pool = await get_pool()

    async with pool.acquire() as conn:
        for show in parsed.get("shows", []):
            show_id = uuid.uuid4()

            await conn.execute(
                """INSERT INTO shows (id, title, category, source_email_id, start_date,
                       end_date, show_times, description, status, confidence,
                       extracted_at, created_at, updated_at)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$11)""",
                show_id,
                show.get("title"),
                show.get("category"),
                None,
                show.get("start_date"),
                show.get("end_date"),
                show.get("show_times", []),
                show.get("description"),
                "new",
                show.get("confidence"),
                now,
            )

            for price in show.get("prices", []):
                await conn.execute(
                    """INSERT INTO prices (id, show_id, tier, amount_min, amount_max,
                           currency, min_group_size, contact_name, contact_email,
                           contact_phone, created_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
                    uuid.uuid4(), show_id,
                    price.get("tier", "general"),
                    price.get("amount_min"),
                    price.get("amount_max"),
                    price.get("currency", "USD"),
                    price.get("min_group_size"),
                    price.get("contact_name"),
                    price.get("contact_email"),
                    price.get("contact_phone"),
                    now,
                )

            venue = show.get("venue")
            if venue and venue.get("name"):
                try:
                    await conn.execute(
                        """INSERT INTO venues (id, name, address, city, state, zip,
                               created_at, updated_at)
                           VALUES ($1,$2,$3,$4,$5,$6,$7,$7)""",
                        uuid.uuid4(),
                        venue["name"],
                        venue.get("address"),
                        venue.get("city"),
                        venue.get("state"),
                        venue.get("zip"),
                        now,
                    )
                except Exception:
                    pass

            show_count += 1

    return {"show_count": show_count}
