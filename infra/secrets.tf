# ------------------------------------------------------------------
# Secrets
# ------------------------------------------------------------------
resource "google_secret_manager_secret" "anthropic_api_key" {
  secret_id = "anthropic-api-key"
  project   = google_project.amplify.project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "anthropic_api_key" {
  secret      = google_secret_manager_secret.anthropic_api_key.id
  secret_data = var.anthropic_api_key
}

resource "google_secret_manager_secret" "mailgun_api_key" {
  secret_id = "mailgun-api-key"
  project   = google_project.amplify.project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "mailgun_api_key" {
  secret      = google_secret_manager_secret.mailgun_api_key.id
  secret_data = var.mailgun_api_key
}
