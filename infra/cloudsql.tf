# ------------------------------------------------------------------
# Cloud SQL — Postgres 16
# ------------------------------------------------------------------
resource "google_sql_database_instance" "amplify" {
  name             = "amplify-db"
  database_version = "POSTGRES_16"
  region           = var.region
  project          = google_project.amplify.project_id

  settings {
    tier              = "db-f1-micro"
    availability_type = "ZONAL"

    ip_configuration {
      ipv4_enabled = true
    }

    backup_configuration {
      enabled = true
    }
  }

  deletion_protection = true

  depends_on = [google_project_service.apis["sqladmin.googleapis.com"]]
}

resource "google_sql_database" "amplify" {
  name     = "amplify"
  instance = google_sql_database_instance.amplify.name
  project  = google_project.amplify.project_id
}

resource "random_password" "db_password" {
  length  = 32
  special = false
}

resource "google_sql_user" "amplify" {
  name     = "amplify"
  instance = google_sql_database_instance.amplify.name
  password = random_password.db_password.result
  project  = google_project.amplify.project_id
}

# ------------------------------------------------------------------
# DB password in Secret Manager
# ------------------------------------------------------------------
resource "google_secret_manager_secret" "db_password" {
  secret_id = "db-password"
  project   = google_project.amplify.project_id

  replication {
    auto {}
  }

  depends_on = [google_project_service.apis["secretmanager.googleapis.com"]]
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = random_password.db_password.result
}
