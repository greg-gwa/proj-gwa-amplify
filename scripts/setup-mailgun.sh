#!/bin/bash
# Setup Mailgun domain and inbound route for Amplify
# Requires: MAILGUN_API_KEY env var and INGEST_URL (Cloud Run service URL)
set -euo pipefail

MAILGUN_API_KEY="${MAILGUN_API_KEY:?Set MAILGUN_API_KEY}"
DOMAIN="${DOMAIN:-amplify.gwanalytics.ai}"
INGEST_URL="${INGEST_URL:?Set INGEST_URL (Cloud Run service URL)}"

echo "=== Creating Mailgun domain: $DOMAIN ==="
curl -s --user "api:${MAILGUN_API_KEY}" \
  https://api.mailgun.net/v3/domains \
  -F name="${DOMAIN}" | python3 -m json.tool

echo ""
echo "=== Creating inbound route ==="
curl -s --user "api:${MAILGUN_API_KEY}" \
  https://api.mailgun.net/v3/routes \
  -F priority=0 \
  -F description="Amplify ingest webhook" \
  -F "expression=match_recipient('.*@${DOMAIN}')" \
  -F "action=forward('${INGEST_URL}/inbound')" \
  -F "action=store()" \
  -F "action=stop()" | python3 -m json.tool

echo ""
echo "=== Add these DNS records to your domain ==="
echo "MX  | amplify | mxa.mailgun.org | 10"
echo "MX  | amplify | mxb.mailgun.org | 10"
echo "TXT | amplify | v=spf1 include:mailgun.org ~all"
echo "TXT | pic._domainkey.amplify | (run 'curl --user api:KEY https://api.mailgun.net/v3/domains/DOMAIN' to get DKIM key)"
echo "CNAME | email.amplify | mailgun.org"
echo ""
echo "=== Done. Verify domain once DNS propagates: ==="
echo "curl --user 'api:KEY' -X PUT https://api.mailgun.net/v3/domains/${DOMAIN}/verify"
