# ------------------------------------------------------------------
# Cloud Scheduler — Hourly Radar Scout
# ------------------------------------------------------------------
resource "google_cloud_scheduler_job" "radar_scout" {
  name        = "radar-scout"
  description = "Hourly FCC political filing scan — all stations, 6h lookback"
  schedule    = "0 * * * *"
  time_zone   = "America/New_York"
  project     = google_project.amplify.project_id
  region      = var.region

  http_target {
    http_method = "POST"
    uri         = "${google_cloud_run_v2_service.ingest.uri}/scan"

    headers = {
      "Content-Type" = "application/json"
    }

    body = base64encode("{\"lookback_hours\": 6}")

    oidc_token {
      service_account_email = google_service_account.ingest_runtime.email
      audience              = google_cloud_run_v2_service.ingest.uri
    }
  }

  retry_config {
    retry_count = 0
  }

  depends_on = [
    google_project_service.apis["cloudscheduler.googleapis.com"],
    google_cloud_run_v2_service.ingest,
  ]
}
