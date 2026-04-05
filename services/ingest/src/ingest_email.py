import json
import logging
import uuid
from datetime import datetime, timezone

from google.cloud import storage
from src.db import get_pool
from src.extract_shows import extract_shows
from src.extract_buy import extract_buy
from src.parse_attachments import parse_attachments

logger = logging.getLogger(__name__)

GCS = storage.Client(project="proj-amplify")
BUCKET = "amplify-raw-emails"


async def handle_inbound_email(body: dict, files: list[dict]) -> dict:
    email_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)

    # Mailgun field names
    sender = str(body.get("from", body.get("sender", "")))
    recipient = str(body.get("recipient", body.get("To", body.get("to", ""))))
    subject = str(body.get("subject", body.get("Subject", "")))
    text = str(body.get("body-plain", body.get("stripped-text", body.get("text", ""))))
    html = str(body.get("body-html", body.get("stripped-html", body.get("html", ""))))

    logger.info(f"Processing email from: {sender}, to: {recipient}, subject: {subject}")
    logger.info(f"Body length: text={len(text)}, html={len(html)}, attachments={len(files)}")

    # 1. Store raw email in Cloud Storage
    raw_path = None
    try:
        raw_path = f"emails/{email_id}.json"
        bucket = GCS.bucket(BUCKET)
        blob = bucket.blob(raw_path)
        blob.upload_from_string(
            json.dumps({
                "id": email_id,
                "from": sender,
                "to": recipient,
                "subject": subject,
                "text": text,
                "html": html,
                "attachment_names": [f["filename"] for f in files],
                "received_at": now.isoformat(),
            }),
            content_type="application/json",
        )
    except Exception as e:
        logger.error(f"Storage write failed (continuing): {e}")

    # 2. Store in Postgres raw_emails
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO raw_emails (id, received_at, from_address, to_address, subject,
                   body_text, body_html, raw_storage_path, attachment_count, processed, processed_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)""",
            uuid.UUID(email_id), now, sender, recipient, subject,
            text, html, raw_path, len(files), False, None,
        )

    # 3. Parse attachments (Excel, PDF)
    attachment_texts = await parse_attachments(files)

    # 4. Determine email type and extract accordingly
    full_content = f"From: {sender}\nSubject: {subject}\n\n{text}"
    if attachment_texts:
        full_content += "\n\n--- ATTACHMENTS ---\n" + "\n\n".join(attachment_texts)

    # Try buy extraction first (political ad spending)
    buy_result = await extract_buy(full_content, email_id)
    buy_count = buy_result.get("buy_count", 0) if buy_result else 0

    # Also try show extraction (entertainment)
    show_result = await extract_shows(
        sender=sender, subject=subject, text=text, html=html, files=files
    )
    show_count = show_result.get("show_count", 0) if show_result else 0

    # 5. Mark email as processed
    if buy_count > 0 or show_count > 0:
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE raw_emails SET processed = TRUE, processed_at = $1 WHERE id = $2",
                datetime.now(timezone.utc), uuid.UUID(email_id),
            )
        logger.info(f"Email {email_id} processed: {buy_count} buys, {show_count} shows")

    return {
        "email_id": email_id,
        "show_count": show_count,
        "buy_count": buy_count,
        "raw_path": raw_path,
    }
