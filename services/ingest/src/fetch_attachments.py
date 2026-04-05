import json
import logging
import os

import httpx

logger = logging.getLogger(__name__)

MAILGUN_API_KEY = os.environ.get("MAILGUN_API_KEY", "")
MAILGUN_DOMAIN = "amplify.gwanalytics.ai"


async def fetch_mailgun_attachments(body: dict) -> list[dict]:
    """Fetch attachments from Mailgun's stored message API.

    When Mailgun forwards via webhook, attachments sometimes don't come through
    as proper multipart file uploads. This function fetches them from Mailgun's
    message storage API as a fallback.
    """
    if not MAILGUN_API_KEY:
        logger.warning("MAILGUN_API_KEY not set — cannot fetch attachments")
        return []

    # Get the message URL from the webhook payload
    # Mailgun includes a 'message-url' field in some cases, but for routes
    # we need to use the storage key
    message_url = body.get("message-url", "")

    # If no message-url, try to find the message via the Message-Id header
    if not message_url:
        message_id = body.get("Message-Id", "")
        if not message_id:
            logger.warning("No message-url or Message-Id — cannot fetch attachments")
            return []

        # Search for the message in Mailgun storage
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"https://api.mailgun.net/v3/{MAILGUN_DOMAIN}/events",
                    auth=("api", MAILGUN_API_KEY),
                    params={"limit": 5, "event": "stored",
                            "message-id": message_id},
                )
                if resp.status_code == 200:
                    events = resp.json().get("items", [])
                    for event in events:
                        storage = event.get("storage", {})
                        if storage.get("url"):
                            message_url = storage["url"]
                            break
        except Exception as e:
            logger.error(f"Failed to search Mailgun events: {e}")

    if not message_url:
        # Last resort: search by recent stored events
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"https://api.mailgun.net/v3/{MAILGUN_DOMAIN}/events",
                    auth=("api", MAILGUN_API_KEY),
                    params={"limit": 3, "event": "stored"},
                )
                if resp.status_code == 200:
                    subject = body.get("subject", "")
                    for event in resp.json().get("items", []):
                        evt_subj = event.get("message", {}).get("headers", {}).get("subject", "")
                        if evt_subj == subject:
                            message_url = event.get("storage", {}).get("url", "")
                            break
        except Exception as e:
            logger.error(f"Failed to search Mailgun events: {e}")

    if not message_url:
        logger.warning("Could not find message URL in Mailgun storage")
        return []

    logger.info(f"Fetching message from Mailgun: {message_url}")

    files = []
    try:
        async with httpx.AsyncClient() as client:
            # Fetch the stored message (JSON format includes attachment URLs)
            resp = await client.get(
                message_url,
                auth=("api", MAILGUN_API_KEY),
            )
            if resp.status_code != 200:
                logger.error(f"Failed to fetch message: {resp.status_code}")
                return []

            msg = resp.json()
            attachments = msg.get("attachments", [])
            logger.info(f"Message has {len(attachments)} attachments")

            for att in attachments:
                att_url = att.get("url")
                att_name = att.get("name", "unknown")
                att_type = att.get("content-type", "application/octet-stream")

                if not att_url:
                    continue

                logger.info(f"Downloading attachment: {att_name} ({att_type})")
                att_resp = await client.get(
                    att_url,
                    auth=("api", MAILGUN_API_KEY),
                )
                if att_resp.status_code == 200:
                    files.append({
                        "filename": att_name,
                        "content_type": att_type,
                        "content": att_resp.content,
                    })
                    logger.info(f"Downloaded: {att_name}, {len(att_resp.content)} bytes")
                else:
                    logger.error(f"Failed to download {att_name}: {att_resp.status_code}")

    except Exception as e:
        logger.error(f"Error fetching attachments: {e}")

    return files
