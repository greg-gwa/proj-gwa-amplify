# Amplify

Performing arts & entertainment aggregation platform. Ingests venue emails, extracts structured show data via LLM, serves it through an API.

## Architecture

```
Email → SendGrid Inbound Parse → Cloud Run (ingest) → BigQuery + Cloud Storage
                                       ↓
                                  Claude (extraction)
```

## GCP Project

- **Project ID:** `proj-amplify`
- **Org:** gwanalytics.ai
- **Region:** us-central1
- **Service Account:** `amplify-deploy@proj-amplify.iam.gserviceaccount.com`

## Infrastructure

| Resource | Location |
|---|---|
| BigQuery Dataset | `proj-amplify.amplify` |
| Tables | `raw_emails`, `shows`, `venues`, `prices` |
| Cloud Storage | `gs://amplify-raw-emails` |
| Artifact Registry | `us-central1-docker.pkg.dev/proj-amplify/amplify-app` |

## Services

### ingest (`services/ingest/`)
Receives SendGrid webhook POSTs, extracts show data via Claude, stores in BigQuery.

**Endpoints:**
- `POST /inbound` — SendGrid Inbound Parse webhook
- `GET /health` — Health check

## DNS (pending domain)

Temp subdomain: `amplify.gwanalytics.ai`
- `inbound.amplify.gwanalytics.ai` → MX → SendGrid
- `api.amplify.gwanalytics.ai` → Cloud Run

## Deployment

```bash
cd services/ingest
gcloud builds submit --tag us-central1-docker.pkg.dev/proj-amplify/amplify-app/ingest
gcloud run deploy amplify-ingest \
  --image us-central1-docker.pkg.dev/proj-amplify/amplify-app/ingest \
  --project proj-amplify \
  --region us-central1 \
  --service-account amplify-deploy@proj-amplify.iam.gserviceaccount.com \
  --set-env-vars RAW_BUCKET=amplify-raw-emails \
  --set-secrets ANTHROPIC_API_KEY=anthropic-api-key:latest \
  --allow-unauthenticated
```

## Handoff

Transfer entire project: `gcloud projects move proj-amplify --organization=THEIR_ORG_ID`
