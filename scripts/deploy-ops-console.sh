#!/bin/bash
set -euo pipefail

PROJECT=proj-amplify
REGION=us-central1
REPO="${REGION}-docker.pkg.dev/${PROJECT}/amplify-app"
IMAGE="${REPO}/amplify-ops-console:latest"
SERVICE_DIR="$(dirname "$0")/../services/ops-console"

echo "=== Building ops-console image ==="
cd "$SERVICE_DIR"
gcloud builds submit --tag "$IMAGE" --project="$PROJECT"

echo ""
echo "=== Deploying to Cloud Run ==="
gcloud run deploy amplify-ops-console \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="$IMAGE" \
  --port=3000 \
  --memory=512Mi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=3 \
  --timeout=60 \
  --set-env-vars="DATABASE_URL=postgresql://amplify:ZcLiQ5iT8DplSKtwlHBmeAzHJoqIydyH@/amplify?host=/cloudsql/${PROJECT}:${REGION}:amplify-db" \
  --add-cloudsql-instances="${PROJECT}:${REGION}:amplify-db" \
  --quiet

echo ""
echo "=== Done! ==="
gcloud run services describe amplify-ops-console --project="$PROJECT" --region="$REGION" --format='value(status.url)'
