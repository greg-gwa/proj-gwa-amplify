# ------------------------------------------------------------------
# Cloud Run — Ingest Service
# ------------------------------------------------------------------
resource "google_cloud_run_v2_service" "ingest" {
  name     = "amplify-ingest"
  location = var.region
  project  = google_project.amplify.project_id

  template {
    service_account = google_service_account.ingest_runtime.email

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.amplify.connection_name]
      }
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/amplify-app/ingest:latest"

      ports {
        container_port = 8080
      }

      env {
        name  = "RAW_BUCKET"
        value = google_storage_bucket.raw_emails.name
      }

      env {
        name = "ANTHROPIC_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.anthropic_api_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "DATABASE_URL"
        value = "postgresql://amplify:${random_password.db_password.result}@/amplify?host=/cloudsql/${google_sql_database_instance.amplify.connection_name}"
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }

      startup_probe {
        http_get {
          path = "/health"
        }
        initial_delay_seconds = 5
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 5
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_secret_manager_secret_version.anthropic_api_key,
    google_sql_database.amplify,
  ]
}

# Allow unauthenticated (Mailgun webhooks)
resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.ingest.name
  location = var.region
  project  = google_project.amplify.project_id
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ------------------------------------------------------------------
# Cloud Run — Ops Console (Next.js frontend + API)
# ------------------------------------------------------------------
resource "google_cloud_run_v2_service" "ops_console" {
  name     = "amplify-ops-console"
  location = var.region
  project  = google_project.amplify.project_id

  template {
    service_account = google_service_account.ingest_runtime.email

    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.amplify.connection_name]
      }
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/amplify-app/ops-console:latest"

      ports {
        container_port = 8080
      }

      env {
        name  = "DATABASE_URL"
        value = "postgresql://amplify:${random_password.db_password.result}@/amplify?host=/cloudsql/${google_sql_database_instance.amplify.connection_name}"
      }

      env {
        name = "ANTHROPIC_API_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.anthropic_api_key.secret_id
            version = "latest"
          }
        }
      }

      env {
        name  = "INGEST_URL"
        value = google_cloud_run_v2_service.ingest.uri
      }

      env {
        name  = "AUTH_PASSWORD"
        value = "callmeAL"
      }

      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "1Gi"
        }
      }

      startup_probe {
        http_get {
          path = "/login"
        }
        initial_delay_seconds = 10
      }
    }

    scaling {
      min_instance_count = 0
      max_instance_count = 3
    }
  }

  depends_on = [
    google_project_service.apis["run.googleapis.com"],
    google_secret_manager_secret_version.anthropic_api_key,
    google_sql_database.amplify,
  ]
}

# Custom domain mapping
resource "google_cloud_run_domain_mapping" "ops_console" {
  name     = "almedia.gwanalytics.ai"
  location = var.region
  project  = google_project.amplify.project_id

  metadata {
    namespace = google_project.amplify.project_id
  }

  spec {
    route_name = google_cloud_run_v2_service.ops_console.name
  }

  depends_on = [google_cloud_run_v2_service.ops_console]
}

# Allow unauthenticated (app handles its own auth via password)
resource "google_cloud_run_v2_service_iam_member" "ops_console_public" {
  name     = google_cloud_run_v2_service.ops_console.name
  location = var.region
  project  = google_project.amplify.project_id
  role     = "roles/run.invoker"
  member   = "allUsers"
}
