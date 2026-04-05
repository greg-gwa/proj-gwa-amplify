# ------------------------------------------------------------------
# Artifact Registry
# ------------------------------------------------------------------
resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = "amplify-app"
  format        = "DOCKER"
  description   = "Amplify container images"
  project       = google_project.amplify.project_id

  depends_on = [google_project_service.apis["artifactregistry.googleapis.com"]]
}

# ------------------------------------------------------------------
# Cloud Storage — raw email archive
# ------------------------------------------------------------------
resource "google_storage_bucket" "raw_emails" {
  name          = "amplify-raw-emails"
  location      = var.region
  project       = google_project.amplify.project_id
  force_destroy = false

  uniform_bucket_level_access = true

  lifecycle_rule {
    condition {
      age = 365
    }
    action {
      type          = "SetStorageClass"
      storage_class = "COLDLINE"
    }
  }

  depends_on = [google_project_service.apis["storage.googleapis.com"]]
}

# Grant ingest SA write access
resource "google_storage_bucket_iam_member" "ingest_writer" {
  bucket = google_storage_bucket.raw_emails.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_service_account.ingest_runtime.email}"
}
