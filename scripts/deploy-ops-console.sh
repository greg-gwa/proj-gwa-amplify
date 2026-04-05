#!/bin/bash
set -euo pipefail

PROJECT=proj-amplify
REGION=us-central1
REPO="${REGION}-docker.pkg.dev/${PROJECT}/amplify-app"
IMAGE="${REPO}/ops-console:latest"
SERVICE_DIR="$(dirname "$0")/../services/ops-console"

echo "=== Building ops-console image ==="
docker build --platform linux/amd64 -t "$IMAGE" "$SERVICE_DIR"

echo ""
echo "=== Pushing to Artifact Registry ==="
docker push "$IMAGE"

echo ""
echo "=== Deploying to Cloud Run ==="
gcloud run deploy amplify-ops-console \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --allow-unauthenticated \
  --service-account="amplify-ingest@${PROJECT}.iam.gserviceaccount.com" \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --set-env-vars="AUTH_PASSWORD=callmeAL,INGEST_URL=https://amplify-ingest-pjkizmet3a-uc.a.run.app,PGUSER=amplify,PGPASSWORD=ZcLiQ5iT8DplSKtwlHBmeAzHJoqIydyH,PGDATABASE=amplify,PGHOST=/cloudsql/${PROJECT}:${REGION}:amplify-db" \
  --set-secrets="ANTHROPIC_API_KEY=anthropic-api-key:latest" \
  --add-cloudsql-instances="${PROJECT}:${REGION}:amplify-db"

echo ""
echo "=== Done! ==="
gcloud run services describe amplify-ops-console --project="$PROJECT" --region="$REGION" --format='value(status.url)'
