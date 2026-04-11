#!/usr/bin/env bash
set -euo pipefail

PROJECT="proj-amplify"
REGION="us-central1"
JOB_NAME="amplify-ingest-job"
SERVICE_ACCOUNT="amplify-deploy@${PROJECT}.iam.gserviceaccount.com"

# The same exact image that runs the web service
IMAGE="${IMAGE:-us-central1-docker.pkg.dev/proj-amplify/amplify-app/amplify-ingest:latest}"

echo "==> Deploying Cloud Run Job: ${JOB_NAME}"

# We need the Cloud SQL instance connection name for the job to mount the socket
SQL_INSTANCE="proj-amplify:us-central1:amplify-db"
DB_URL="postgresql://amplify:ZcLiQ5iT8DplSKtwlHBmeAzHJoqIydyH@/amplify?host=/cloudsql/${SQL_INSTANCE}"

CMD="gcloud run jobs update"
if ! gcloud run jobs describe "${JOB_NAME}" --region="${REGION}" --project="${PROJECT}" &>/dev/null; then
  CMD="gcloud run jobs create"
fi

$CMD "${JOB_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --image="${IMAGE}" \
  --command="python" \
  --args="-m,src.run_job" \
  --service-account="${SERVICE_ACCOUNT}" \
  --memory="4Gi" \
  --cpu="2" \
  --task-timeout="10800" \
  --max-retries="0" \
  --set-cloudsql-instances="${SQL_INSTANCE}" \
  --set-env-vars="DATABASE_URL=${DB_URL},RAW_BUCKET=amplify-raw-emails" \
  --set-secrets="ANTHROPIC_API_KEY=anthropic-api-key:latest,MAILGUN_API_KEY=mailgun-api-key:latest,OPENAI_API_KEY=openai-api-key:latest,CM_USERNAME=cm-username:latest,CM_PASSWORD=cm-password:latest,CM_BASE_URL=cm-base-url:latest"

echo "==> Job '${JOB_NAME}' is ready."
