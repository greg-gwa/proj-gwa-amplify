#!/bin/bash
set -euo pipefail

PROJECT=proj-amplify
REGION=us-central1
REPO="${REGION}-docker.pkg.dev/${PROJECT}/amplify-app"
IMAGE="${REPO}/amplify-ingest:latest"
SERVICE_DIR="$(dirname "$0")/../services/ingest"

echo "=== Building ingest image (Cloud Build) ==="
cd "$SERVICE_DIR"
gcloud builds submit --tag "$IMAGE" --project="$PROJECT"

echo ""
echo "=== Deploying to Cloud Run ==="
gcloud run deploy amplify-ingest \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --allow-unauthenticated \
  --service-account="amplify-ingest@${PROJECT}.iam.gserviceaccount.com" \
  --port=8080 \
  --memory=1Gi \
  --cpu=2 \
  --min-instances=0 \
  --max-instances=5 \
  --timeout=3600 \
  --no-cpu-throttling \
  --set-env-vars="RAW_BUCKET=amplify-raw-emails,DATABASE_URL=postgresql://amplify:ZcLiQ5iT8DplSKtwlHBmeAzHJoqIydyH@/amplify?host=/cloudsql/${PROJECT}:${REGION}:amplify-db" \
  --set-secrets="ANTHROPIC_API_KEY=anthropic-api-key:latest,MAILGUN_API_KEY=mailgun-api-key:latest,OPENAI_API_KEY=openai-api-key:latest,CM_USERNAME=cm-username:latest,CM_PASSWORD=cm-password:latest,CM_BASE_URL=cm-base-url:latest" \
  --add-cloudsql-instances="${PROJECT}:${REGION}:amplify-db" \
  --quiet

echo ""
echo "=== Done! ==="
gcloud run services describe amplify-ingest --project="$PROJECT" --region="$REGION" --format='value(status.url)'
