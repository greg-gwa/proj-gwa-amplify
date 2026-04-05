# ------------------------------------------------------------------
# Project
# ------------------------------------------------------------------
resource "google_project" "amplify" {
  name            = "Amplify"
  project_id      = var.project_id
  org_id          = var.org_id
  billing_account = var.billing_account

  lifecycle {
    prevent_destroy = true
  }
}

# ------------------------------------------------------------------
# APIs
# ------------------------------------------------------------------
locals {
  apis = [
    "run.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "bigquery.googleapis.com",
    "sqladmin.googleapis.com",
    "storage.googleapis.com",
    "cloudscheduler.googleapis.com",
  ]
}

resource "google_project_service" "apis" {
  for_each = toset(local.apis)
  project  = google_project.amplify.project_id
  service  = each.value

  disable_dependent_services = false
  disable_on_destroy         = false
}
