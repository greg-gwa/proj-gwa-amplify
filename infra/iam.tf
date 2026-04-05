# ------------------------------------------------------------------
# Deploy Service Account
# ------------------------------------------------------------------
resource "google_service_account" "deploy" {
  account_id   = "amplify-deploy"
  display_name = "Amplify Deploy"
  project      = google_project.amplify.project_id
}

locals {
  deploy_roles = [
    "roles/run.admin",
    "roles/artifactregistry.writer",
    "roles/secretmanager.secretAccessor",
    "roles/bigquery.admin",
    "roles/cloudbuild.builds.builder",
    "roles/iam.serviceAccountUser",
  ]
}

resource "google_project_iam_member" "deploy" {
  for_each = toset(local.deploy_roles)
  project  = google_project.amplify.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.deploy.email}"
}

# ------------------------------------------------------------------
# Cloud Run Service Account (runtime)
# ------------------------------------------------------------------
resource "google_service_account" "ingest_runtime" {
  account_id   = "amplify-ingest"
  display_name = "Amplify Ingest Runtime"
  project      = google_project.amplify.project_id
}

locals {
  runtime_roles = [
    "roles/bigquery.dataEditor",
    "roles/bigquery.jobUser",
    "roles/storage.objectCreator",
    "roles/secretmanager.secretAccessor",
    "roles/cloudsql.client",
  ]
}

resource "google_project_iam_member" "ingest_runtime" {
  for_each = toset(local.runtime_roles)
  project  = google_project.amplify.project_id
  role     = each.value
  member   = "serviceAccount:${google_service_account.ingest_runtime.email}"
}

# ------------------------------------------------------------------
# Cloud Build default SA permissions
# ------------------------------------------------------------------
locals {
  cloudbuild_roles = [
    "roles/storage.admin",
    "roles/artifactregistry.writer",
  ]
}

resource "google_project_iam_member" "cloudbuild_compute" {
  for_each = toset(local.cloudbuild_roles)
  project  = google_project.amplify.project_id
  role     = each.value
  member   = "serviceAccount:${google_project.amplify.number}-compute@developer.gserviceaccount.com"
}

resource "google_project_iam_member" "cloudbuild_sa" {
  for_each = toset(local.cloudbuild_roles)
  project  = google_project.amplify.project_id
  role     = each.value
  member   = "serviceAccount:${google_project.amplify.number}@cloudbuild.gserviceaccount.com"
}

# ------------------------------------------------------------------
# Default Compute SA — needs secrets + SQL for gcloud run deploy
# ------------------------------------------------------------------
locals {
  compute_roles = [
    "roles/secretmanager.secretAccessor",
    "roles/cloudsql.client",
  ]
}

resource "google_project_iam_member" "compute_default" {
  for_each = toset(local.compute_roles)
  project  = google_project.amplify.project_id
  role     = each.value
  member   = "serviceAccount:${google_project.amplify.number}-compute@developer.gserviceaccount.com"
}
