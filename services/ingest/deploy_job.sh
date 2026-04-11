#!/usr/bin/env bash
# deploy_job.sh — Create or update the amplify-ingest-job Cloud Run Job.
#
# Usage:
#   ./deploy_job.sh                   # create (or update) the job
#   ./deploy_job.sh --execute <uuid>  # execute the job immediately with a given SCAN_ID
#
# Prerequisites:
#   gcloud auth login && gcloud config set project proj-amplify
#   IMAGE must be a fully-pushed container image (build & push before running this)
set -euo pipefail

PROJECT="proj-amplify"
REGION="us-central1"
JOB_NAME="amplify-ingest-job"
SERVICE_ACCOUNT="amplify-deploy@${PROJECT}.iam.gserviceaccount.com"

# Image to use — override with IMAGE env var if needed
IMAGE="${IMAGE:-gcr.io/${PROJECT}/ingest:latest}"

echo "==> Deploying Cloud Run Job: ${JOB_NAME}"
echo "    Image: ${IMAGE}"

# gcloud run jobs create fails if the job already exists, so try update first
if gcloud run jobs describe "${JOB_NAME}" --region="${REGION}" --project="${PROJECT}" &>/dev/null; then
  echo "==> Job exists — updating..."
  gcloud run jobs update "${JOB_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT}" \
    --image="${IMAGE}"
else
  echo "==> Job not found — creating..."
  gcloud run jobs create "${JOB_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT}" \
    --image="${IMAGE}" \
    --command="python" \
    --args="-m,src.run_job" \
    --service-account="${SERVICE_ACCOUNT}" \
    --memory="2Gi" \
    --cpu="2" \
    --task-timeout="3600" \
    --max-retries="0" \
    --set-secrets="DATABASE_URL=amplify-db-url:latest"
fi

echo ""
echo "==> Done. Job '${JOB_NAME}' is ready in ${REGION}."
echo ""
echo "To trigger a scan manually:"
echo "  gcloud run jobs execute ${JOB_NAME} \\"
echo "    --region=${REGION} \\"
echo "    --update-env-vars=SCAN_ID=<uuid> \\"
echo "    --update-env-vars=MARKET_IDS='[\"<market-uuid>\"]'"

# --execute flag: run the job immediately for a given SCAN_ID
if [[ "${1:-}" == "--execute" ]]; then
  SCAN_ID="${2:?'Usage: deploy_job.sh --execute <scan_id>'}"
  echo ""
  echo "==> Executing job with SCAN_ID=${SCAN_ID} ..."
  gcloud run jobs execute "${JOB_NAME}" \
    --region="${REGION}" \
    --project="${PROJECT}" \
    --update-env-vars="SCAN_ID=${SCAN_ID}"
  echo "==> Execution started."
fi
