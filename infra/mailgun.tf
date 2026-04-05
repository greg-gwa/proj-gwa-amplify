# ------------------------------------------------------------------
# Mailgun (via API — no official Terraform provider, use null_resource)
# ------------------------------------------------------------------

# Note: Mailgun doesn't have an official Terraform provider.
# Domain and route setup is documented here for reference.
# Use the setup script (scripts/setup-mailgun.sh) to configure.

# Domain: amplify.gwanalytics.ai
# Route: *@amplify.gwanalytics.ai → POST to Cloud Run ingest webhook
# MX Records (add to DNS):
#   amplify → mxa.mailgun.org (priority 10)
#   amplify → mxb.mailgun.org (priority 10)
# TXT: amplify → v=spf1 include:mailgun.org ~all
# TXT: pic._domainkey.amplify → (DKIM key)
# CNAME: email.amplify → mailgun.org
